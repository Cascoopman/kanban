import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";

const testHome = join("/tmp", "kanban-runtime-api-test-home");

const agentRegistryMocks = vi.hoisted(() => ({
	resolveAgentCommand: vi.fn(),
	buildRuntimeConfigResponse: vi.fn(),
}));

const taskWorktreeMocks = vi.hoisted(() => ({
	getTaskWorkspacePathInfo: vi.fn(),
	resolveTaskCwd: vi.fn(),
}));

const codexSessionResolverMocks = vi.hoisted(() => ({
	resolveCodexSessionIdForCwd: vi.fn(),
}));

const claudeSessionResolverMocks = vi.hoisted(() => ({
	resolveClaudeSessionIdForCwd: vi.fn(),
}));

const turnCheckpointMocks = vi.hoisted(() => ({
	captureTaskTurnCheckpoint: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
	openInBrowser: vi.fn(),
}));

vi.mock("node:os", () => ({
	homedir: () => testHome,
}));

vi.mock("../../../src/terminal/agent-registry.js", () => ({
	resolveAgentCommand: agentRegistryMocks.resolveAgentCommand,
	buildRuntimeConfigResponse: agentRegistryMocks.buildRuntimeConfigResponse,
}));

vi.mock("../../../src/workspace/task-worktree.js", () => ({
	getTaskWorkspacePathInfo: taskWorktreeMocks.getTaskWorkspacePathInfo,
	resolveTaskCwd: taskWorktreeMocks.resolveTaskCwd,
}));

vi.mock("../../../src/terminal/codex-session-resolver.js", () => ({
	resolveCodexSessionIdForCwd: codexSessionResolverMocks.resolveCodexSessionIdForCwd,
}));

vi.mock("../../../src/terminal/claude-session-resolver.js", () => ({
	resolveClaudeSessionIdForCwd: claudeSessionResolverMocks.resolveClaudeSessionIdForCwd,
}));

vi.mock("../../../src/workspace/turn-checkpoints.js", () => ({
	captureTaskTurnCheckpoint: turnCheckpointMocks.captureTaskTurnCheckpoint,
}));

vi.mock("../../../src/server/browser.js", () => ({
	openInBrowser: browserMocks.openInBrowser,
}));

import type { RuntimeTrpcContext } from "../../../src/trpc/app-router";
import { type CreateRuntimeApiDependencies, createRuntimeApi } from "../../../src/trpc/runtime-api";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: 1,
		updatedAt: 2,
		lastOutputAt: 2,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

function createRuntimeConfigState(selectedAgentId: "claude" | "codex" = "claude"): RuntimeConfigState {
	return {
		selectedAgentId,
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		readyForReviewNotificationsEnabled: true,
		shortcuts: [],
		quickPrompts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
	};
}

function createTestRuntimeApi(overrides: Partial<CreateRuntimeApiDependencies> = {}): RuntimeTrpcContext["runtimeApi"] {
	const runtimeConfig = createRuntimeConfigState();
	return createRuntimeApi({
		getActiveWorkspaceId: vi.fn(() => "workspace-1"),
		getActiveRuntimeConfig: vi.fn(() => runtimeConfig),
		loadScopedRuntimeConfig: vi.fn(async () => runtimeConfig),
		setActiveRuntimeConfig: vi.fn(),
		getScopedTerminalManager: vi.fn(),
		resolveInteractiveShellCommand: vi.fn(() => ({ binary: "/bin/zsh", args: ["-l"] })),
		runCommand: vi.fn(),
		...overrides,
	});
}

const workspaceScope = {
	workspaceId: "workspace-1",
	workspacePath: "/tmp/repo",
};

describe("createRuntimeApi terminal task sessions", () => {
	beforeEach(() => {
		agentRegistryMocks.resolveAgentCommand.mockReset();
		agentRegistryMocks.buildRuntimeConfigResponse.mockReset();
		taskWorktreeMocks.getTaskWorkspacePathInfo.mockReset();
		taskWorktreeMocks.resolveTaskCwd.mockReset();
		codexSessionResolverMocks.resolveCodexSessionIdForCwd.mockReset();
		claudeSessionResolverMocks.resolveClaudeSessionIdForCwd.mockReset();
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockReset();
		browserMocks.openInBrowser.mockReset();

		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "claude",
			label: "Claude Code",
			command: "claude",
			binary: "claude",
			args: [],
		});
		codexSessionResolverMocks.resolveCodexSessionIdForCwd.mockResolvedValue(null);
		claudeSessionResolverMocks.resolveClaudeSessionIdForCwd.mockResolvedValue(null);
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockResolvedValue({
			turn: 1,
			ref: "refs/kanban/checkpoints/task-1/turn/1",
			commit: "1111111",
			createdAt: 1,
		});
	});

	it("reuses an existing worktree and captures the initial turn checkpoint", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		const summary = createSummary();
		const checkpointedSummary = createSummary({
			latestTurnCheckpoint: {
				turn: 1,
				ref: "refs/kanban/checkpoints/task-1/turn/1",
				commit: "1111111",
				createdAt: 1,
			},
		});
		const terminalManager = {
			getSummary: vi.fn(() => null),
			startTaskSession: vi.fn(async () => summary),
			applyTurnCheckpoint: vi.fn(() => checkpointedSummary),
		};
		const api = createTestRuntimeApi({
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
		});

		const response = await api.startTaskSession(workspaceScope, {
			taskId: "task-1",
			baseRef: "main",
			prompt: "Investigate startup freeze",
		});

		expect(response).toEqual({ ok: true, summary: checkpointedSummary });
		expect(taskWorktreeMocks.resolveTaskCwd).toHaveBeenCalledWith({
			cwd: "/tmp/repo",
			taskId: "task-1",
			baseRef: "main",
			ensure: false,
		});
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				agentId: "claude",
				cwd: "/tmp/existing-worktree",
				prompt: "Investigate startup freeze",
			}),
		);
		expect(terminalManager.applyTurnCheckpoint).toHaveBeenCalledWith("task-1", expect.objectContaining({ turn: 1 }));
	});

	it("ensures a worktree when no existing task cwd is available", async () => {
		taskWorktreeMocks.resolveTaskCwd
			.mockRejectedValueOnce(new Error("missing"))
			.mockResolvedValueOnce("/tmp/new-worktree");
		const terminalManager = {
			getSummary: vi.fn(() => null),
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const api = createTestRuntimeApi({
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
		});

		const response = await api.startTaskSession(workspaceScope, {
			taskId: "task-1",
			baseRef: "main",
			prompt: "Fix startup",
		});

		expect(response.ok).toBe(true);
		expect(taskWorktreeMocks.resolveTaskCwd).toHaveBeenNthCalledWith(2, {
			cwd: "/tmp/repo",
			taskId: "task-1",
			baseRef: "main",
			ensure: true,
		});
	});

	it("uses the persisted terminal agent when resuming a task", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/worktree");
		const terminalManager = {
			getSummary: vi.fn(() => createSummary({ agentId: "codex", state: "interrupted" })),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const loadScopedRuntimeConfig = vi.fn(async () => createRuntimeConfigState("claude"));
		const api = createTestRuntimeApi({
			loadScopedRuntimeConfig,
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
		});

		await api.startTaskSession(workspaceScope, {
			taskId: "task-1",
			baseRef: "main",
			prompt: "Continue",
			resumeExistingSession: "running",
		});

		expect(agentRegistryMocks.resolveAgentCommand).toHaveBeenCalledWith(
			expect.objectContaining({ selectedAgentId: "codex" }),
		);
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
	});

	it("forks the source Codex session for a branched task", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/target-worktree");
		taskWorktreeMocks.getTaskWorkspacePathInfo.mockResolvedValue({ path: "/tmp/source-worktree" });
		codexSessionResolverMocks.resolveCodexSessionIdForCwd
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce("source-session-id");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});
		const terminalManager = {
			getSummary: vi.fn(() => null),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const api = createTestRuntimeApi({
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
		});

		await api.startTaskSession(workspaceScope, {
			taskId: "task-2",
			baseRef: "main",
			prompt: "Branch this work",
			agentId: "codex",
			branchedFromTaskId: "task-1",
		});

		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({ codexForkSessionId: "source-session-id" }),
		);
	});

	it("inherits the running source agent when a branched task has no override", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/target-worktree");
		taskWorktreeMocks.getTaskWorkspacePathInfo.mockResolvedValue({ path: "/tmp/source-worktree" });
		codexSessionResolverMocks.resolveCodexSessionIdForCwd
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce("source-session-id");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});
		const terminalManager = {
			getSummary: vi.fn((taskId: string) =>
				taskId === "task-1" ? createSummary({ taskId, agentId: "codex" }) : null,
			),
			startTaskSession: vi.fn(async () => createSummary({ taskId: "task-2", agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const api = createTestRuntimeApi({
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
		});

		await api.startTaskSession(workspaceScope, {
			taskId: "task-2",
			baseRef: "main",
			prompt: "Branch this work",
			branchedFromTaskId: "task-1",
		});

		expect(agentRegistryMocks.resolveAgentCommand).toHaveBeenCalledWith(
			expect.objectContaining({ selectedAgentId: "codex" }),
		);
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({ agentId: "codex", codexForkSessionId: "source-session-id" }),
		);
	});

	it("forks the source Claude session for a branched task", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/target-worktree");
		taskWorktreeMocks.getTaskWorkspacePathInfo.mockResolvedValue({ path: "/tmp/source-worktree" });
		claudeSessionResolverMocks.resolveClaudeSessionIdForCwd
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce("source-session-id");
		const terminalManager = {
			getSummary: vi.fn(() => null),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "claude" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const api = createTestRuntimeApi({
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
		});

		await api.startTaskSession(workspaceScope, {
			taskId: "task-2",
			baseRef: "main",
			prompt: "Branch this work",
			agentId: "claude",
			branchedFromTaskId: "task-1",
		});

		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({ claudeForkSessionId: "source-session-id" }),
		);
	});

	it("routes stop and input through the terminal manager", async () => {
		const summary = createSummary();
		const terminalManager = {
			stopTaskSession: vi.fn(() => summary),
			writeInput: vi.fn(() => summary),
		};
		const api = createTestRuntimeApi({
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
		});

		const inputResponse = await api.sendTaskSessionInput(workspaceScope, {
			taskId: "task-1",
			text: "continue",
			appendNewline: true,
		});
		const stopResponse = await api.stopTaskSession(workspaceScope, { taskId: "task-1" });

		expect(inputResponse).toEqual({ ok: true, summary });
		expect(terminalManager.writeInput).toHaveBeenCalledWith("task-1", Buffer.from("continue\n", "utf8"));
		expect(stopResponse).toEqual({ ok: true, summary });
		expect(terminalManager.stopTaskSession).toHaveBeenCalledWith("task-1");
	});
});

describe("createRuntimeApi maintenance endpoints", () => {
	beforeEach(() => {
		rmSync(testHome, { recursive: true, force: true });
	});

	it("runs reset teardown before deleting Kanban storage", async () => {
		const resetPaths = [join(testHome, ".kanban")];
		for (const path of resetPaths) {
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, "state.json"), "{}");
		}
		const prepareForStateReset = vi.fn(async () => {});
		const api = createTestRuntimeApi({ prepareForStateReset });

		const response = await api.resetAllState(null);

		expect(prepareForStateReset).toHaveBeenCalledTimes(1);
		expect(response).toEqual({ ok: true, clearedPaths: resetPaths });
	});
});
