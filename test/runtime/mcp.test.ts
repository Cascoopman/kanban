import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createKanbanMcpServer, type KanbanMcpOperations } from "../../src/mcp";

function createOperations(calls: Array<{ name: string; input: unknown }>): KanbanMcpOperations {
	const record = async (name: string, input: unknown) => {
		calls.push({ name, input });
		return { ok: true, name, input };
	};

	return {
		listTasks: async (input) => await record("listTasks", input),
		getCurrentTask: async (input) => await record("getCurrentTask", input),
		createTask: async (input) => await record("createTask", input),
		branchTask: async (input) => await record("branchTask", input),
		updateTask: async (input) => await record("updateTask", input),
		startTask: async (input) => await record("startTask", input),
		trashTask: async (input) => await record("trashTask", input),
		deleteTask: async (input) => await record("deleteTask", input),
		notify: (input) => ({ ok: true, name: "notify", input }),
		readLogs: async (input) => await record("readLogs", input),
		resolveCurrentTaskId: (taskId) => taskId ?? "current-task",
	};
}

async function connectMcp(operations: KanbanMcpOperations) {
	const server = createKanbanMcpServer({ cwd: "/workspace", operations });
	const client = new Client({ name: "kanban-mcp-test", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return { client, server };
}

describe("Kanban MCP", () => {
	it("publishes the complete agent-facing surface with accurate safety annotations", async () => {
		const calls: Array<{ name: string; input: unknown }> = [];
		const { client, server } = await connectMcp(createOperations(calls));
		try {
			const { tools } = await client.listTools();
			expect(tools.map((tool) => tool.name).sort()).toEqual([
				"kanban_logs",
				"kanban_notify",
				"kanban_task_branch",
				"kanban_task_create",
				"kanban_task_current",
				"kanban_task_delete",
				"kanban_task_list",
				"kanban_task_start",
				"kanban_task_trash",
				"kanban_task_update",
			]);

			const byName = new Map(tools.map((tool) => [tool.name, tool]));
			expect(byName.get("kanban_task_list")?.annotations?.readOnlyHint).toBe(true);
			expect(byName.get("kanban_logs")?.annotations?.readOnlyHint).toBe(true);
			expect(byName.get("kanban_task_trash")?.annotations?.destructiveHint).toBe(true);
			expect(byName.get("kanban_task_delete")?.annotations?.destructiveHint).toBe(true);
			expect(byName.get("kanban_task_create")?.annotations?.readOnlyHint).toBe(false);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("maps every tool to its operation, preserves task context, and returns structured content", async () => {
		const calls: Array<{ name: string; input: unknown }> = [];
		const { client, server } = await connectMcp(createOperations(calls));
		try {
			const invoke = async (name: string, args: Record<string, unknown>) => {
				const result = await client.callTool({ name, arguments: args });
				expect(result.isError).not.toBe(true);
				expect(result.structuredContent).toMatchObject({ ok: true });
			};

			await invoke("kanban_task_list", { project_path: "/repo", column: "done" });
			await invoke("kanban_task_current", { project_path: "/repo" });
			await invoke("kanban_task_create", {
				title: "Implement MCP",
				project_path: "/repo",
				base_ref: "main",
				start_in_plan_mode: true,
				agent_id: "codex",
			});
			await invoke("kanban_task_branch", { title: "Split test coverage", project_path: "/repo" });
			await invoke("kanban_task_update", { title: "Updated title", agent_id: null, project_path: "/repo" });
			await invoke("kanban_task_start", { task_id: "task-1", prompt: "Continue", project_path: "/repo" });
			await invoke("kanban_task_trash", { column: "done", project_path: "/repo" });
			await invoke("kanban_task_delete", { task_id: "task-2", project_path: "/repo" });
			await invoke("kanban_notify", { message: "Please act now", modal: true });
			await invoke("kanban_logs", { source: "backend", tail: 12 });

			expect(calls).toEqual([
				{ name: "listTasks", input: { cwd: "/workspace", projectPath: "/repo", column: "trash" } },
				{ name: "getCurrentTask", input: { cwd: "/workspace", projectPath: "/repo" } },
				{
					name: "createTask",
					input: {
						cwd: "/workspace",
						title: "Implement MCP",
						projectPath: "/repo",
						baseRef: "main",
						startInPlanMode: true,
						agentId: "codex",
					},
				},
				{
					name: "branchTask",
					input: {
						cwd: "/workspace",
						taskId: "current-task",
						title: "Split test coverage",
						prompt: undefined,
						projectPath: "/repo",
					},
				},
				{
					name: "updateTask",
					input: {
						cwd: "/workspace",
						taskId: "current-task",
						title: "Updated title",
						projectPath: "/repo",
						baseRef: undefined,
						startInPlanMode: undefined,
						agentId: null,
					},
				},
				{
					name: "startTask",
					input: { cwd: "/workspace", taskId: "task-1", projectPath: "/repo", prompt: "Continue" },
				},
				{
					name: "trashTask",
					input: { cwd: "/workspace", taskId: undefined, column: "trash", projectPath: "/repo" },
				},
				{
					name: "deleteTask",
					input: { cwd: "/workspace", taskId: "task-2", column: undefined, projectPath: "/repo" },
				},
				{ name: "readLogs", input: { sources: ["backend"], tail: 12 } },
			]);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("rejects destructive calls without exactly one target before they reach the operation", async () => {
		const calls: Array<{ name: string; input: unknown }> = [];
		const { client, server } = await connectMcp(createOperations(calls));
		try {
			const result = await client.callTool({ name: "kanban_task_delete", arguments: {} });
			expect(result.isError).toBe(true);
			expect(calls).toEqual([]);
		} finally {
			await client.close();
			await server.close();
		}
	});
});
