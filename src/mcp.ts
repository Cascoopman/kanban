import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import packageJson from "../package.json" with { type: "json" };
import { readLogLines } from "./commands/logs";
import {
	branchTask,
	createTask,
	deleteTask,
	getCurrentTask,
	type JsonRecord,
	LIST_TASK_COLUMNS,
	type ListTaskColumn,
	listTasks,
	resolveCurrentTaskId,
	sendUrgentTaskNotification,
	startTask,
	trashTask,
	updateTaskCommand,
} from "./commands/task";
import type { RuntimeAgentId } from "./core/api-contract";
import { LOG_SOURCES, type LogSource } from "./logging/log-files";

const KANBAN_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

const MUTATING = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
} as const;

const DESTRUCTIVE = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
} as const;

const taskColumnSchema = z.enum([...LIST_TASK_COLUMNS, "done"]);

interface TaskOperationInput {
	cwd: string;
	projectPath?: string;
}

export interface KanbanMcpOperations {
	listTasks: (input: TaskOperationInput & { column?: ListTaskColumn }) => Promise<JsonRecord>;
	getCurrentTask: (input: TaskOperationInput) => Promise<JsonRecord>;
	createTask: (
		input: TaskOperationInput & {
			title: string;
			baseRef?: string;
			startInPlanMode?: boolean;
			agentId?: RuntimeAgentId;
		},
	) => Promise<JsonRecord>;
	branchTask: (input: TaskOperationInput & { taskId: string; title: string; prompt?: string }) => Promise<JsonRecord>;
	updateTask: (
		input: TaskOperationInput & {
			taskId: string;
			title?: string;
			baseRef?: string;
			startInPlanMode?: boolean;
			agentId?: RuntimeAgentId | null;
		},
	) => Promise<JsonRecord>;
	startTask: (input: TaskOperationInput & { taskId: string; prompt?: string }) => Promise<JsonRecord>;
	trashTask: (input: TaskOperationInput & { taskId?: string; column?: ListTaskColumn }) => Promise<JsonRecord>;
	deleteTask: (input: TaskOperationInput & { taskId?: string; column?: ListTaskColumn }) => Promise<JsonRecord>;
	notify: (input: {
		message: string;
		title?: string;
		subtitle?: string;
		sound?: string;
		modal?: boolean;
	}) => JsonRecord;
	readLogs: (input: { sources: readonly LogSource[]; tail: number }) => Promise<JsonRecord>;
	resolveCurrentTaskId: (explicitTaskId: string | undefined, commandName: string) => string;
}

function normalizeTaskColumn(column: z.infer<typeof taskColumnSchema> | undefined): ListTaskColumn | undefined {
	if (column === undefined) {
		return undefined;
	}
	return column === "done" ? "trash" : column;
}

function createDefaultOperations(): KanbanMcpOperations {
	return {
		listTasks,
		getCurrentTask,
		createTask,
		branchTask,
		updateTask: updateTaskCommand,
		startTask,
		trashTask,
		deleteTask,
		notify: sendUrgentTaskNotification,
		async readLogs({ sources, tail }) {
			return {
				ok: true,
				logs: await readLogLines(sources, tail),
			};
		},
		resolveCurrentTaskId,
	};
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : String(error);
}

function toToolResult(payload: JsonRecord) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
		structuredContent: payload,
	};
}

async function runTool(handler: () => Promise<JsonRecord> | JsonRecord) {
	try {
		return toToolResult(await handler());
	} catch (error) {
		return {
			content: [{ type: "text" as const, text: `Kanban MCP tool failed: ${toErrorMessage(error)}` }],
			isError: true,
		};
	}
}

function exactlyOneTaskTarget(
	input: { task_id?: string; column?: z.infer<typeof taskColumnSchema> },
	context: z.RefinementCtx,
) {
	if (Boolean(input.task_id?.trim()) === Boolean(input.column)) {
		context.addIssue({
			code: "custom",
			message: "Provide exactly one of task_id or column.",
			path: ["task_id"],
		});
	}
}

export function createKanbanMcpServer(options: { cwd?: string; operations?: KanbanMcpOperations } = {}): McpServer {
	const cwd = options.cwd ?? process.cwd();
	const operations = options.operations ?? createDefaultOperations();
	const server = new McpServer(
		{
			name: "kanban",
			version: KANBAN_VERSION,
		},
		{
			instructions:
				"Use these tools as the canonical interface to Kanban tasks and logs. " +
				"In a Kanban task session, omit task_id to target the current task. " +
				"Pass project_path when acting outside a task session or when the target workspace is not implicit. " +
				"Trash removes a task worktree; delete permanently removes task records and worktrees, so obtain user confirmation before either destructive operation.",
		},
	);

	server.registerTool(
		"kanban_task_list",
		{
			title: "List Kanban tasks",
			description: "List active Kanban tasks for a workspace, optionally limited to one board column.",
			inputSchema: {
				project_path: z.string().trim().min(1).optional(),
				column: taskColumnSchema.optional(),
			},
			annotations: READ_ONLY,
		},
		async ({ project_path, column }) =>
			await runTool(
				async () =>
					await operations.listTasks({ cwd, projectPath: project_path, column: normalizeTaskColumn(column) }),
			),
	);

	server.registerTool(
		"kanban_task_current",
		{
			title: "Get current Kanban task",
			description: "Get the task associated with the current Kanban agent session.",
			inputSchema: { project_path: z.string().trim().min(1).optional() },
			annotations: READ_ONLY,
		},
		async ({ project_path }) =>
			await runTool(async () => await operations.getCurrentTask({ cwd, projectPath: project_path })),
	);

	server.registerTool(
		"kanban_task_create",
		{
			title: "Create and start Kanban task",
			description: "Create an in-progress task and immediately start its configured agent session.",
			inputSchema: {
				title: z.string().trim().min(1),
				project_path: z.string().trim().min(1).optional(),
				base_ref: z.string().trim().min(1).optional(),
				start_in_plan_mode: z.boolean().optional(),
				agent_id: z.enum(["claude", "codex"]).optional(),
			},
			annotations: MUTATING,
		},
		async ({ title, project_path, base_ref, start_in_plan_mode, agent_id }) =>
			await runTool(
				async () =>
					await operations.createTask({
						cwd,
						title,
						projectPath: project_path,
						baseRef: base_ref,
						startInPlanMode: start_in_plan_mode,
						agentId: agent_id,
					}),
			),
	);

	server.registerTool(
		"kanban_task_branch",
		{
			title: "Branch Kanban task",
			description: "Branch a task worktree and agent conversation into a new running task.",
			inputSchema: {
				title: z.string().trim().min(1),
				task_id: z.string().trim().min(1).optional(),
				prompt: z.string().optional(),
				project_path: z.string().trim().min(1).optional(),
			},
			annotations: MUTATING,
		},
		async ({ title, task_id, prompt, project_path }) =>
			await runTool(
				async () =>
					await operations.branchTask({
						cwd,
						taskId: operations.resolveCurrentTaskId(task_id, "kanban_task_branch"),
						title,
						prompt,
						projectPath: project_path,
					}),
			),
	);

	server.registerTool(
		"kanban_task_update",
		{
			title: "Update Kanban task",
			description: "Update a task title, base ref, plan-mode setting, or assigned agent.",
			inputSchema: {
				task_id: z.string().trim().min(1).optional(),
				title: z.string().trim().min(1).optional(),
				project_path: z.string().trim().min(1).optional(),
				base_ref: z.string().trim().min(1).optional(),
				start_in_plan_mode: z.boolean().optional(),
				agent_id: z.enum(["claude", "codex"]).nullable().optional(),
			},
			annotations: MUTATING,
		},
		async ({ task_id, title, project_path, base_ref, start_in_plan_mode, agent_id }) =>
			await runTool(
				async () =>
					await operations.updateTask({
						cwd,
						taskId: operations.resolveCurrentTaskId(task_id, "kanban_task_update"),
						title,
						projectPath: project_path,
						baseRef: base_ref,
						startInPlanMode: start_in_plan_mode,
						agentId: agent_id,
					}),
			),
	);

	server.registerTool(
		"kanban_task_start",
		{
			title: "Start Kanban task",
			description: "Start or restart an in-progress task session.",
			inputSchema: {
				task_id: z.string().trim().min(1),
				project_path: z.string().trim().min(1).optional(),
				prompt: z.string().optional(),
			},
			annotations: MUTATING,
		},
		async ({ task_id, project_path, prompt }) =>
			await runTool(
				async () => await operations.startTask({ cwd, taskId: task_id, projectPath: project_path, prompt }),
			),
	);

	const destructiveTargetSchema = z
		.object({
			task_id: z.string().trim().min(1).optional(),
			column: taskColumnSchema.optional(),
			project_path: z.string().trim().min(1).optional(),
		})
		.superRefine(exactlyOneTaskTarget);

	server.registerTool(
		"kanban_task_trash",
		{
			title: "Trash Kanban task",
			description:
				"Move one task or a board column to trash (done) and remove affected task worktrees. Requires user confirmation.",
			inputSchema: destructiveTargetSchema,
			annotations: DESTRUCTIVE,
		},
		async ({ task_id, column, project_path }) =>
			await runTool(
				async () =>
					await operations.trashTask({
						cwd,
						taskId: task_id,
						column: normalizeTaskColumn(column),
						projectPath: project_path,
					}),
			),
	);

	server.registerTool(
		"kanban_task_delete",
		{
			title: "Permanently delete Kanban task",
			description:
				"Permanently delete one task or a board column and remove task worktrees. Requires explicit user confirmation.",
			inputSchema: destructiveTargetSchema,
			annotations: DESTRUCTIVE,
		},
		async ({ task_id, column, project_path }) =>
			await runTool(
				async () =>
					await operations.deleteTask({
						cwd,
						taskId: task_id,
						column: normalizeTaskColumn(column),
						projectPath: project_path,
					}),
			),
	);

	server.registerTool(
		"kanban_notify",
		{
			title: "Send urgent Kanban alert",
			description:
				"Send a macOS modal alert and Notification Center notification when the user must act within minutes.",
			inputSchema: {
				message: z.string().trim().min(1),
				title: z.string().trim().min(1).optional(),
				subtitle: z.string().trim().min(1).optional(),
				sound: z.string().trim().min(1).optional(),
				modal: z.boolean().optional(),
			},
			annotations: MUTATING,
		},
		async ({ message, title, subtitle, sound, modal }) =>
			await runTool(() => operations.notify({ message, title, subtitle, sound, modal })),
	);

	server.registerTool(
		"kanban_logs",
		{
			title: "Read Kanban logs",
			description: "Read a bounded snapshot of persisted frontend and backend Kanban logs.",
			inputSchema: {
				source: z.enum(["frontend", "backend", "all"]).default("all"),
				tail: z.number().int().min(0).max(1_000).default(200),
			},
			annotations: READ_ONLY,
		},
		async ({ source, tail }) =>
			await runTool(
				async () => await operations.readLogs({ sources: source === "all" ? LOG_SOURCES : [source], tail }),
			),
	);

	return server;
}

async function main(): Promise<void> {
	const server = createKanbanMcpServer();
	await server.connect(new StdioServerTransport());
}

function getInvokedEntrypointUrl(): string | null {
	if (!process.argv[1]) {
		return null;
	}
	try {
		return pathToFileURL(realpathSync(process.argv[1])).href;
	} catch {
		return pathToFileURL(resolve(process.argv[1])).href;
	}
}

const invokedEntrypoint = getInvokedEntrypointUrl();
if (invokedEntrypoint === import.meta.url) {
	void main().catch((error) => {
		process.stderr.write(`Failed to start Kanban MCP: ${toErrorMessage(error)}\n`);
		process.exitCode = 1;
	});
}
