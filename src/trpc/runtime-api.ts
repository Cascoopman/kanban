// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed terminal and config behavior
// should stay in focused services instead of accumulating here.

import { rm } from "node:fs/promises";
import { TRPCError } from "@trpc/server";
import type { RuntimeConfigState } from "../config/runtime-config";
import { updateGlobalRuntimeConfig, updateRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeCommandRunResponse,
	RuntimeVsCodeWebRequest,
	RuntimeVsCodeWebResponse,
} from "../core/api-contract";
import {
	parseCommandRunRequest,
	parseRuntimeConfigSaveRequest,
	parseShellSessionStartRequest,
	parseTaskSessionInputRequest,
	parseTaskSessionStartRequest,
	parseTaskSessionStopRequest,
} from "../core/api-validation";
import { getRuntimeHomePath } from "../core/runtime-home";
import { openInBrowser } from "../server/browser";
import type { VsCodeWebManager } from "../server/vscode-web-manager";
import { buildRuntimeConfigResponse, resolveAgentCommand } from "../terminal/agent-registry";
import { resolveClaudeSessionIdForCwd } from "../terminal/claude-session-resolver";
import { resolveCodexSessionIdForCwd } from "../terminal/codex-session-resolver";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { getTaskWorkspacePathInfo, resolveTaskCwd } from "../workspace/task-worktree";
import { captureTaskTurnCheckpoint } from "../workspace/turn-checkpoints";
import type { RuntimeTrpcContext, RuntimeTrpcWorkspaceScope } from "./app-router";

export interface CreateRuntimeApiDependencies {
	getActiveWorkspaceId: () => string | null;
	getActiveRuntimeConfig?: () => RuntimeConfigState;
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
	setActiveRuntimeConfig: (config: RuntimeConfigState) => void;
	getScopedTerminalManager: (scope: RuntimeTrpcWorkspaceScope) => Promise<TerminalSessionManager>;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	prepareForStateReset?: () => Promise<void>;
	vsCodeWebManager?: VsCodeWebManager;
	vsCodeWebSupported?: boolean;
}

async function resolveExistingTaskCwdOrEnsure(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
}): Promise<string> {
	try {
		return await resolveTaskCwd({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: options.baseRef,
			ensure: false,
		});
	} catch {
		return await resolveTaskCwd({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: options.baseRef,
			ensure: true,
		});
	}
}

export function createRuntimeApi(deps: CreateRuntimeApiDependencies): RuntimeTrpcContext["runtimeApi"] {
	const debugResetTargetPaths = [getRuntimeHomePath()] as const;

	const buildConfigResponse = (runtimeConfig: RuntimeConfigState) => buildRuntimeConfigResponse(runtimeConfig);

	return {
		loadConfig: async (workspaceScope) => {
			const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
			if (!workspaceScope && !activeRuntimeConfig) {
				throw new Error("No active runtime config provider is available.");
			}
			let scopedRuntimeConfig: RuntimeConfigState;
			if (workspaceScope) {
				scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
			} else if (activeRuntimeConfig) {
				scopedRuntimeConfig = activeRuntimeConfig;
			} else {
				throw new Error("No active runtime config provider is available.");
			}
			return buildConfigResponse(scopedRuntimeConfig);
		},
		saveConfig: async (workspaceScope, input) => {
			const parsed = parseRuntimeConfigSaveRequest(input);
			let nextRuntimeConfig: RuntimeConfigState;
			if (workspaceScope) {
				nextRuntimeConfig = await updateRuntimeConfig(workspaceScope.workspacePath, parsed);
			} else {
				const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
				if (!activeRuntimeConfig) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "No active runtime config is available.",
					});
				}
				nextRuntimeConfig = await updateGlobalRuntimeConfig(activeRuntimeConfig, parsed);
			}
			if (workspaceScope && workspaceScope.workspaceId === deps.getActiveWorkspaceId()) {
				deps.setActiveRuntimeConfig(nextRuntimeConfig);
			}
			if (!workspaceScope) {
				deps.setActiveRuntimeConfig(nextRuntimeConfig);
			}
			return buildConfigResponse(nextRuntimeConfig);
		},
		startTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStartRequest(input);
				const shouldResumeSession = body.resumeFromTrash || body.resumeExistingSession !== undefined;
				const scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
				const taskCwd = await resolveExistingTaskCwdOrEnsure({
					cwd: workspaceScope.workspacePath,
					taskId: body.taskId,
					baseRef: body.baseRef,
				});
				const shouldCaptureTurnCheckpoint = !shouldResumeSession;

				// Per-task config source-of-truth precedence:
				//
				// agentId resolution (which agent runtime to use):
				//   1. previousTerminalAgentId — persisted in the terminal session summary from
				//      the last run; ensures trash-restore resumes with the same agent runtime.
				//   2. body.agentId — the card's current per-task agent override.
				//   3. sourceTerminalAgentId — the source session used for a branched task.
				//   4. scopedRuntimeConfig.selectedAgentId — the workspace-level default.
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const previousTerminalAgentId = shouldResumeSession
					? (terminalManager.getSummary(body.taskId)?.agentId ?? null)
					: null;
				const sourceTerminalAgentId = body.branchedFromTaskId
					? (terminalManager.getSummary(body.branchedFromTaskId)?.agentId ?? null)
					: null;
				const effectiveAgentId =
					previousTerminalAgentId ?? body.agentId ?? sourceTerminalAgentId ?? scopedRuntimeConfig.selectedAgentId;
				const resolvedConfig =
					effectiveAgentId !== scopedRuntimeConfig.selectedAgentId
						? { ...scopedRuntimeConfig, selectedAgentId: effectiveAgentId }
						: scopedRuntimeConfig;
				const resolved = resolveAgentCommand(resolvedConfig);
				if (!resolved) {
					return {
						ok: false,
						summary: null,
						error: "No runnable agent command is configured. Open Settings, install a supported CLI, and select it.",
					};
				}
				let claudeResumeSessionId: string | undefined;
				let claudeForkSessionId: string | undefined;
				let codexResumeSessionId: string | undefined;
				let codexForkSessionId: string | undefined;
				if (shouldResumeSession || body.branchedFromTaskId) {
					const resolveSessionIdForCwd =
						resolved.agentId === "claude" ? resolveClaudeSessionIdForCwd : resolveCodexSessionIdForCwd;
					const existingSessionId = await resolveSessionIdForCwd(taskCwd);
					let resumeSessionId: string | undefined;
					let forkSessionId: string | undefined;
					if (existingSessionId) {
						resumeSessionId = existingSessionId;
					} else if (body.branchedFromTaskId) {
						const sourceWorkspace = await getTaskWorkspacePathInfo({
							cwd: workspaceScope.workspacePath,
							taskId: body.branchedFromTaskId,
							baseRef: body.baseRef,
						});
						forkSessionId = (await resolveSessionIdForCwd(sourceWorkspace.path)) ?? undefined;
					}
					if (resolved.agentId === "claude") {
						claudeResumeSessionId = resumeSessionId;
						claudeForkSessionId = forkSessionId;
					} else {
						codexResumeSessionId = resumeSessionId;
						codexForkSessionId = forkSessionId;
					}
				}
				const summary = await terminalManager.startTaskSession({
					taskId: body.taskId,
					agentId: resolved.agentId,
					binary: resolved.binary,
					args: resolved.args,
					autonomousModeEnabled: scopedRuntimeConfig.agentAutonomousModeEnabled,
					cwd: taskCwd,
					projectCwd: workspaceScope.workspacePath,
					prompt: body.prompt,
					startInPlanMode: body.startInPlanMode,
					resumeFromTrash: body.resumeFromTrash,
					resumeExistingSession: body.resumeExistingSession,
					claudeResumeSessionId,
					claudeForkSessionId,
					codexResumeSessionId,
					codexForkSessionId,
					cols: body.cols,
					rows: body.rows,
					workspaceId: workspaceScope.workspaceId,
				});

				let nextSummary = summary;
				if (shouldCaptureTurnCheckpoint) {
					try {
						const nextTurn = (summary.latestTurnCheckpoint?.turn ?? 0) + 1;
						const checkpoint = await captureTaskTurnCheckpoint({
							cwd: taskCwd,
							taskId: body.taskId,
							turn: nextTurn,
						});
						nextSummary = terminalManager.applyTurnCheckpoint(body.taskId, checkpoint) ?? summary;
					} catch {
						// Best effort checkpointing only.
					}
				}
				return {
					ok: true,
					summary: nextSummary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		stopTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStopRequest(input);
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.stopTaskSession(body.taskId);
				return {
					ok: Boolean(summary),
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		sendTaskSessionInput: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionInputRequest(input);
				const payloadText = body.appendNewline ? `${body.text}\n` : body.text;
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.writeInput(body.taskId, Buffer.from(payloadText, "utf8"));
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task session is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		startShellSession: async (workspaceScope, input) => {
			try {
				const body = parseShellSessionStartRequest(input);
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const shell = deps.resolveInteractiveShellCommand();
				const shellCwd = body.workspaceTaskId
					? await resolveTaskCwd({
							cwd: workspaceScope.workspacePath,
							taskId: body.workspaceTaskId,
							baseRef: body.baseRef,
							ensure: true,
						})
					: workspaceScope.workspacePath;
				const summary = await terminalManager.startShellSession({
					taskId: body.taskId,
					cwd: shellCwd,
					cols: body.cols,
					rows: body.rows,
					binary: shell.binary,
					args: shell.args,
				});
				return {
					ok: true,
					summary,
					shellBinary: shell.binary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					shellBinary: null,
					error: message,
				};
			}
		},
		runCommand: async (workspaceScope, input) => {
			try {
				const body = parseCommandRunRequest(input);
				return await deps.runCommand(body.command, workspaceScope.workspacePath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message,
				});
			}
		},
		resetAllState: async (_workspaceScope) => {
			await deps.prepareForStateReset?.();
			await Promise.all(
				debugResetTargetPaths.map(async (path) => {
					await rm(path, { recursive: true, force: true });
				}),
			);
			return {
				ok: true,
				clearedPaths: [...debugResetTargetPaths],
			};
		},
		openFile: async (input) => {
			const filePath = input.filePath.trim();
			if (!filePath) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "File path cannot be empty.",
				});
			}
			openInBrowser(filePath);
			return { ok: true };
		},
		getVsCodeWebStatus: async (workspaceScope, input: RuntimeVsCodeWebRequest): Promise<RuntimeVsCodeWebResponse> => {
			if (!deps.vsCodeWebSupported || !deps.vsCodeWebManager) {
				return {
					status: "unavailable",
					url: null,
					workspacePath: null,
					error: "Inline VS Code is currently available only when Kanban runs locally.",
				};
			}
			return await deps.vsCodeWebManager.getStatus(workspaceScope, input);
		},
		startVsCodeWeb: async (workspaceScope, input: RuntimeVsCodeWebRequest): Promise<RuntimeVsCodeWebResponse> => {
			if (!deps.vsCodeWebSupported || !deps.vsCodeWebManager) {
				return {
					status: "unavailable",
					url: null,
					workspacePath: null,
					error: "Inline VS Code is currently available only when Kanban runs locally.",
				};
			}
			return await deps.vsCodeWebManager.start(workspaceScope, input);
		},
	};
}
