import { join } from "node:path";

import type {
	RuntimeAgentId,
	RuntimeHookEvent,
	RuntimeTaskImage,
	RuntimeTaskSessionSummary,
} from "../core/api-contract";
import { buildKanbanCommandParts } from "../core/kanban-command";
import { quoteShellArg } from "../core/shell";
import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state";
import { loadAgentInstructionsFile, loadGlobalAgentInstructionsFile } from "../workspace/agent-instructions";
import { configureCodexHooks, hasCodexConfigOverride } from "./codex-hook-config";
import { createHookRuntimeEnv } from "./hook-runtime-context";
import { stripAnsi } from "./output-utils";
import type { SessionTransitionEvent } from "./session-state-machine";
import { prepareTaskPromptWithImages } from "./task-image-prompt";

export interface AgentAdapterLaunchInput {
	taskId: string;
	agentId: RuntimeAgentId;
	binary?: string;
	args: string[];
	autonomousModeEnabled?: boolean;
	cwd: string;
	projectCwd?: string;
	prompt: string;
	images?: RuntimeTaskImage[];
	startInPlanMode?: boolean;
	resumeFromTrash?: boolean;
	resumeExistingSession?: boolean;
	claudeResumeSessionId?: string;
	claudeForkSessionId?: string;
	codexResumeSessionId?: string;
	codexForkSessionId?: string;
	env?: Record<string, string | undefined>;
	workspaceId?: string;
	agentInstructions?: string;
}

export type AgentOutputTransitionDetector = (
	data: string,
	summary: RuntimeTaskSessionSummary,
) => SessionTransitionEvent | null;

export type AgentOutputTransitionInspectionPredicate = (summary: RuntimeTaskSessionSummary) => boolean;

export interface PreparedAgentLaunch {
	binary?: string;
	args: string[];
	env: Record<string, string | undefined>;
	cleanup?: () => Promise<void>;
	deferredStartupInput?: string;
	detectOutputTransition?: AgentOutputTransitionDetector;
	shouldInspectOutputForTransition?: AgentOutputTransitionInspectionPredicate;
}

interface HookContext {
	taskId: string;
	workspaceId: string;
}

interface HookCommandMetadata {
	source?: string;
	activityText?: string;
	hookEventName?: string;
	notificationType?: string;
}

interface AgentSessionAdapter {
	prepare(input: AgentAdapterLaunchInput): Promise<PreparedAgentLaunch>;
}

function shouldResumeAgentSession(input: AgentAdapterLaunchInput): boolean {
	return input.resumeFromTrash === true || input.resumeExistingSession === true;
}

function resolveHookContext(input: AgentAdapterLaunchInput): HookContext | null {
	const workspaceId = input.workspaceId?.trim();
	if (!workspaceId) {
		return null;
	}
	return {
		taskId: input.taskId,
		workspaceId,
	};
}

function buildHooksCommandParts(args: string[]): string[] {
	return buildKanbanCommandParts(["hooks", ...args]);
}

function buildHookCommand(event: RuntimeHookEvent, metadata?: HookCommandMetadata): string {
	const parts = buildHooksCommandParts(["ingest", "--event", event]);
	if (metadata?.source) {
		parts.push("--source", metadata.source);
	}
	if (metadata?.activityText) {
		parts.push("--activity-text", metadata.activityText);
	}
	if (metadata?.hookEventName) {
		parts.push("--hook-event-name", metadata.hookEventName);
	}
	if (metadata?.notificationType) {
		parts.push("--notification-type", metadata.notificationType);
	}
	return parts.map(quoteShellArg).join(" ");
}

function hasCliOption(args: string[], optionName: string): boolean {
	for (const arg of args) {
		if (arg === optionName || arg.startsWith(`${optionName}=`)) {
			return true;
		}
	}
	return false;
}

function removeCliOptionWithValue(args: string[], optionNames: readonly string[]): void {
	let index = 0;
	while (index < args.length) {
		const arg = args[index];
		const exactOption = optionNames.includes(arg);
		const inlineOption = optionNames.some(
			(optionName) =>
				arg.startsWith(`${optionName}=`) ||
				(optionName.startsWith("-") &&
					!optionName.startsWith("--") &&
					arg.startsWith(optionName) &&
					arg !== optionName),
		);
		if (exactOption) {
			args.splice(index, Math.min(2, args.length - index));
			continue;
		}
		if (inlineOption) {
			args.splice(index, 1);
			continue;
		}
		index += 1;
	}
}

function removeCliFlags(args: string[], optionNames: readonly string[]): void {
	for (let index = args.length - 1; index >= 0; index -= 1) {
		if (optionNames.includes(args[index])) {
			args.splice(index, 1);
		}
	}
}

function removeClaudeSessionOptions(args: string[]): void {
	removeCliOptionWithValue(args, ["--resume", "-r"]);
	removeCliFlags(args, ["--continue", "-c", "--fork-session"]);
}

function getHookAgentDirectory(agentId: RuntimeAgentId): string {
	return join(getRuntimeHomePath(), "hooks", agentId);
}

async function ensureTextFile(filePath: string, content: string): Promise<void> {
	await lockedFileSystem.writeTextFileAtomic(filePath, content);
}

function withPrompt(args: string[], prompt: string): PreparedAgentLaunch {
	const trimmed = prompt.trim();
	if (trimmed) {
		args.push(trimmed);
	}
	return {
		args,
		env: {},
	};
}

function formatCodexConfigString(value: string): string {
	return JSON.stringify(value);
}

function joinAgentInstructions(...contents: Array<string | undefined>): string | undefined {
	const sections = contents.map((content) => content?.trim()).filter((content): content is string => Boolean(content));
	return sections.length > 0 ? `${sections.join("\n\n")}\n` : undefined;
}

async function resolveAgentInstructions(input: AgentAdapterLaunchInput): Promise<string | undefined> {
	const [globalInstructions, taskProjectInstructions] = await Promise.all([
		loadGlobalAgentInstructionsFile(),
		loadAgentInstructionsFile(input.cwd),
	]);
	const sourceProjectInstructions =
		!taskProjectInstructions.exists && input.projectCwd && input.projectCwd !== input.cwd
			? await loadAgentInstructionsFile(input.projectCwd)
			: null;
	const projectInstructions = taskProjectInstructions.exists ? taskProjectInstructions : sourceProjectInstructions;

	if (input.agentId === "codex" && taskProjectInstructions.exists) {
		return joinAgentInstructions(globalInstructions.content);
	}
	return joinAgentInstructions(globalInstructions.content, projectInstructions?.content);
}

async function writeClaudeAgentInstructions(taskId: string, content: string): Promise<string> {
	const path = join(getHookAgentDirectory("claude"), "instructions", `${encodeURIComponent(taskId)}.md`);
	await ensureTextFile(path, content);
	return path;
}

function toBracketedPasteSubmission(command: string): string {
	return `\u001b[200~${command}\u001b[201~\r`;
}

const CLAUDE_INTERRUPTED_PROMPT_PATTERN = /Interrupted\s*(?:·\s*)?What\s+should\s+Claude\s+do\s+instead\?/u;
const CLAUDE_INTERRUPTED_PROMPT_BUFFER_CHARS = 512;

function createClaudeOutputTransitionDetector(): AgentOutputTransitionDetector {
	let buffer = "";
	return (data, summary) => {
		if (summary.state !== "running") {
			buffer = "";
			return null;
		}

		buffer = `${buffer}${stripAnsi(data)}`.slice(-CLAUDE_INTERRUPTED_PROMPT_BUFFER_CHARS);
		if (!CLAUDE_INTERRUPTED_PROMPT_PATTERN.test(buffer)) {
			return null;
		}

		buffer = "";
		return { type: "hook.to_review" };
	};
}

function shouldInspectClaudeOutputForTransition(summary: RuntimeTaskSessionSummary): boolean {
	return summary.state === "running";
}

const claudeAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const args = [...input.args];
		const env: Record<string, string | undefined> = {
			FORCE_HYPERLINK: "1",
		};
		if (input.autonomousModeEnabled) {
			env.CLAUDE_CODE_ENABLE_AUTO_MODE = "1";
		}
		if (
			input.autonomousModeEnabled &&
			!input.startInPlanMode &&
			!hasCliOption(args, "--permission-mode") &&
			!hasCliOption(args, "--dangerously-skip-permissions")
		) {
			args.push("--dangerously-skip-permissions");
		}
		if (input.claudeForkSessionId) {
			removeClaudeSessionOptions(args);
			args.push("--resume", input.claudeForkSessionId, "--fork-session");
		} else if (input.claudeResumeSessionId) {
			removeClaudeSessionOptions(args);
			args.push("--resume", input.claudeResumeSessionId);
		} else if (shouldResumeAgentSession(input) && !hasCliOption(args, "--continue")) {
			args.push("--continue");
		}
		if (input.startInPlanMode) {
			const withoutImmediateBypass = args.filter((arg) => arg !== "--dangerously-skip-permissions");
			args.length = 0;
			args.push(...withoutImmediateBypass, "--permission-mode", "plan");
		}
		if (input.agentInstructions) {
			args.push(
				"--append-system-prompt-file",
				await writeClaudeAgentInstructions(input.taskId, input.agentInstructions),
			);
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			const settingsPath = join(getHookAgentDirectory("claude"), "settings.json");
			const hooksSettings = {
				hooks: {
					Stop: [{ hooks: [{ type: "command", command: buildHookCommand("to_review", { source: "claude" }) }] }],
					SubagentStop: [
						{ hooks: [{ type: "command", command: buildHookCommand("activity", { source: "claude" }) }] },
					],
					PreToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("activity", { source: "claude" }) }],
						},
					],
					PermissionRequest: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("to_review", { source: "claude" }) }],
						},
					],
					PostToolUse: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("to_in_progress", { source: "claude" }) }],
						},
					],
					PostToolUseFailure: [
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("to_in_progress", { source: "claude" }) }],
						},
					],
					Notification: [
						{
							matcher: "permission_prompt",
							hooks: [{ type: "command", command: buildHookCommand("to_review", { source: "claude" }) }],
						},
						{
							matcher: "*",
							hooks: [{ type: "command", command: buildHookCommand("activity", { source: "claude" }) }],
						},
					],
					UserPromptSubmit: [
						{
							hooks: [{ type: "command", command: buildHookCommand("to_in_progress", { source: "claude" }) }],
						},
					],
				},
			};
			await ensureTextFile(settingsPath, JSON.stringify(hooksSettings, null, 2));
			args.push("--settings", settingsPath);
			Object.assign(env, createHookRuntimeEnv(hooks));
		}

		const launch = withPrompt(args, input.prompt);
		return {
			...launch,
			env: {
				...launch.env,
				...env,
			},
			detectOutputTransition: createClaudeOutputTransitionDetector(),
			shouldInspectOutputForTransition: shouldInspectClaudeOutputForTransition,
		};
	},
};

function codexPromptDetector(data: string, summary: RuntimeTaskSessionSummary): SessionTransitionEvent | null {
	if (summary.state !== "awaiting_review") {
		return null;
	}
	if (summary.reviewReason !== "attention" && summary.reviewReason !== "hook") {
		return null;
	}
	if (/(?:^|\n)\s*›/.test(stripAnsi(data))) {
		return { type: "agent.prompt-ready" };
	}
	return null;
}

function shouldInspectCodexOutputForTransition(summary: RuntimeTaskSessionSummary): boolean {
	return (
		summary.state === "awaiting_review" &&
		(summary.reviewReason === "attention" || summary.reviewReason === "hook" || summary.reviewReason === "error")
	);
}

const codexAdapter: AgentSessionAdapter = {
	async prepare(input) {
		const codexArgs = [...input.args];
		const env: Record<string, string | undefined> = {};
		let deferredStartupInput: string | undefined;

		if (!hasCodexConfigOverride(codexArgs, "check_for_update_on_startup")) {
			codexArgs.push("-c", "check_for_update_on_startup=false");
		}
		if (input.autonomousModeEnabled && !hasCliOption(codexArgs, "--dangerously-bypass-approvals-and-sandbox")) {
			codexArgs.push("--dangerously-bypass-approvals-and-sandbox");
		}
		if (input.agentInstructions) {
			codexArgs.push("-c", `developer_instructions=${formatCodexConfigString(input.agentInstructions)}`);
		}

		if (input.codexResumeSessionId) {
			codexArgs.push("resume", input.codexResumeSessionId);
		} else if (input.codexForkSessionId) {
			removeCliOptionWithValue(codexArgs, ["-C", "--cd"]);
			codexArgs.push("-C", input.cwd, "fork", input.codexForkSessionId);
		} else if (shouldResumeAgentSession(input)) {
			if (!codexArgs.includes("resume")) {
				codexArgs.push("resume");
			}
			if (!hasCliOption(codexArgs, "--last")) {
				codexArgs.push("--last");
			}
		}

		const hooks = resolveHookContext(input);
		if (hooks) {
			configureCodexHooks(codexArgs);
			Object.assign(env, createHookRuntimeEnv(hooks));
		}

		const trimmed = input.prompt.trim();
		if (input.startInPlanMode) {
			deferredStartupInput = toBracketedPasteSubmission(trimmed ? `/plan ${trimmed}` : "/plan");
		} else if (trimmed) {
			codexArgs.push(trimmed);
		}

		return {
			binary: input.binary,
			args: codexArgs,
			env,
			deferredStartupInput,
			detectOutputTransition: codexPromptDetector,
			shouldInspectOutputForTransition: shouldInspectCodexOutputForTransition,
		};
	},
};

const ADAPTERS = {
	claude: claudeAdapter,
	codex: codexAdapter,
} satisfies Partial<Record<RuntimeAgentId, AgentSessionAdapter>>;

export async function prepareAgentLaunch(input: AgentAdapterLaunchInput): Promise<PreparedAgentLaunch> {
	const adapter = ADAPTERS[input.agentId as keyof typeof ADAPTERS];
	if (!adapter) {
		throw new Error(`Unsupported runtime agent: ${input.agentId}`);
	}
	const preparedPrompt = await prepareTaskPromptWithImages({
		prompt: input.prompt,
		images: input.images,
	});
	const agentInstructions = await resolveAgentInstructions(input);
	return await adapter.prepare({
		...input,
		prompt: preparedPrompt,
		agentInstructions,
	});
}
