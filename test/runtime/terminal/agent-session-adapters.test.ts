import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { prepareAgentLaunch } from "../../../src/terminal/agent-session-adapters";

const originalHome = process.env.HOME;
const originalArgv = [...process.argv];
const originalExecArgv = [...process.execArgv];
const originalExecPath = process.execPath;
let tempHome: string | null = null;

function setupTempHome(): string {
	tempHome = mkdtempSync(join(tmpdir(), "kanban-agent-adapters-"));
	process.env.HOME = tempHome;
	return tempHome;
}

function writeGlobalAgentInstructions(content: string): string {
	const home = setupTempHome();
	const path = join(home, ".kanban", "AGENTS.md");
	mkdirSync(join(home, ".kanban"), { recursive: true });
	writeFileSync(path, content);
	return path;
}

function setKanbanProcessContext(): void {
	process.argv = ["node", "/Users/example/repo/dist/cli.js"];
	process.execArgv = [];
	Object.defineProperty(process, "execPath", {
		configurable: true,
		value: "/usr/local/bin/node",
	});
}

function getCodexConfigOverrideValues(args: string[], key: string): string[] {
	const values: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-c" || arg === "--config") {
			const next = args[index + 1];
			if (typeof next === "string" && next.startsWith(`${key}=`)) {
				values.push(next.slice(key.length + 1));
			}
			index += 1;
			continue;
		}
		if (arg.startsWith(`-c${key}=`)) {
			values.push(arg.slice(key.length + 3));
			continue;
		}
		if (arg.startsWith(`--config=${key}=`)) {
			values.push(arg.slice(key.length + 10));
		}
	}
	return values;
}

function createRunningSummary(): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "claude",
		workspacePath: "/tmp",
		pid: 123,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (tempHome) {
		rmSync(tempHome, { recursive: true, force: true });
		tempHome = null;
	}
	process.argv = [...originalArgv];
	process.execArgv = [...originalExecArgv];
	Object.defineProperty(process, "execPath", {
		configurable: true,
		value: originalExecPath,
	});
});

describe("prepareAgentLaunch", () => {
	it("configures Codex hooks without legacy notify", async () => {
		setupTempHome();
		setKanbanProcessContext();
		const launch = await prepareAgentLaunch({
			taskId: "task-1",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp",
			prompt: "",
			workspaceId: "workspace-1",
		});

		expect(launch.env.KANBAN_HOOK_TASK_ID).toBe("task-1");
		expect(launch.env.KANBAN_HOOK_WORKSPACE_ID).toBe("workspace-1");
		expect(launch.env.KANBAN_TASK_ID).toBe("task-1");
		expect(launch.env.KANBAN_WORKSPACE_ID).toBe("workspace-1");
		const launchCommand = [launch.binary ?? "", ...launch.args].join(" ");
		expect(launchCommand).toContain("codex");
		expect(launchCommand).toContain("codex-hook.js");
		expect(launchCommand).not.toContain("dist/cli.js hooks codex-hook");
		expect(launchCommand).toContain("hooks.UserPromptSubmit");
		expect(launchCommand).toContain("hooks.Stop");
		expect(launchCommand).toContain("hooks.PermissionRequest");
		expect(getCodexConfigOverrideValues(launch.args, "features.hooks")).toEqual(["true"]);
		expect(getCodexConfigOverrideValues(launch.args, "features.codex_hooks")).toEqual([]);
		expect(launchCommand).not.toContain("codex-wrapper");
		expect(launchCommand).not.toContain("notify=");
		const wrapperPath = join(homedir(), ".kanban", "hooks", "codex", "codex-wrapper.mjs");
		expect(existsSync(wrapperPath)).toBe(false);
	});

	it("preserves an explicit Codex update-check override", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-codex-custom-update-check",
			agentId: "codex",
			binary: "codex",
			args: ["-c", "check_for_update_on_startup=true"],
			cwd: "/tmp",
			prompt: "",
		});

		expect(getCodexConfigOverrideValues(launch.args, "check_for_update_on_startup")).toEqual(["true"]);
	});

	it("loads Kanban-wide instructions before project instructions for Codex", async () => {
		writeGlobalAgentInstructions("# Shared rules\n\nRun focused tests.\n");
		const launch = await prepareAgentLaunch({
			taskId: "task-codex-global-instructions",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp",
			prompt: "Fix the bug",
			resumeFromTrash: true,
		});

		expect(getCodexConfigOverrideValues(launch.args, "developer_instructions")).toEqual([
			JSON.stringify("# Shared rules\n\nRun focused tests.\n"),
		]);
		expect(launch.args.indexOf("-c")).toBeLessThan(launch.args.indexOf("resume"));
		expect(launch.args.slice(-3)).toEqual(["resume", "--last", "Fix the bug"]);
	});

	it("loads Kanban-wide instructions from a file for Claude", async () => {
		writeGlobalAgentInstructions("# Shared rules\n");
		const launch = await prepareAgentLaunch({
			taskId: "task-claude-global-instructions",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp",
			prompt: "Fix the bug",
		});

		const instructionFlagIndex = launch.args.indexOf("--append-system-prompt-file");
		const instructionsPath = launch.args[instructionFlagIndex + 1];
		expect(instructionsPath).toBe(
			join(homedir(), ".kanban", "hooks", "claude", "instructions", "task-claude-global-instructions.md"),
		);
		expect(readFileSync(instructionsPath, "utf8")).toBe("# Shared rules\n");
		expect(launch.args.indexOf("--append-system-prompt-file")).toBeLessThan(launch.args.indexOf("Fix the bug"));
	});

	it("uses project instructions from the source workspace when the task worktree does not contain them", async () => {
		const home = setupTempHome();
		const projectCwd = join(home, "project");
		const taskCwd = join(home, "task");
		mkdirSync(projectCwd, { recursive: true });
		mkdirSync(taskCwd, { recursive: true });
		writeFileSync(join(projectCwd, "AGENTS.md"), "# Project rules\n");

		const codexLaunch = await prepareAgentLaunch({
			taskId: "task-codex-project-instructions",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: taskCwd,
			projectCwd,
			prompt: "",
		});
		expect(getCodexConfigOverrideValues(codexLaunch.args, "developer_instructions")).toEqual([
			JSON.stringify("# Project rules\n"),
		]);

		const claudeLaunch = await prepareAgentLaunch({
			taskId: "task-claude-project-instructions",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: taskCwd,
			projectCwd,
			prompt: "",
		});
		const instructionFlagIndex = claudeLaunch.args.indexOf("--append-system-prompt-file");
		expect(readFileSync(claudeLaunch.args[instructionFlagIndex + 1], "utf8")).toBe("# Project rules\n");
	});

	it("prepends global instructions without duplicating a task worktree AGENTS.md for Codex", async () => {
		const home = setupTempHome();
		const taskCwd = join(home, "task");
		mkdirSync(join(home, ".kanban"), { recursive: true });
		mkdirSync(taskCwd, { recursive: true });
		writeFileSync(join(home, ".kanban", "AGENTS.md"), "# Global rules\n");
		writeFileSync(join(taskCwd, "AGENTS.md"), "# Project rules\n");

		const codexLaunch = await prepareAgentLaunch({
			taskId: "task-codex-native-project-instructions",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: taskCwd,
			prompt: "",
		});

		expect(getCodexConfigOverrideValues(codexLaunch.args, "developer_instructions")).toEqual([
			JSON.stringify("# Global rules\n"),
		]);
	});

	it("writes Claude settings with explicit permission hooks", async () => {
		setupTempHome();
		await prepareAgentLaunch({
			taskId: "task-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp",
			prompt: "",
			workspaceId: "workspace-1",
		});

		const settingsPath = join(homedir(), ".kanban", "hooks", "claude", "settings.json");
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { hooks?: Record<string, unknown> };
		expect(settings.hooks?.PermissionRequest).toBeDefined();
		expect(settings.hooks?.PreToolUse).toBeDefined();
		expect(settings.hooks?.PostToolUse).toBeDefined();
		expect(settings.hooks?.PostToolUseFailure).toBeDefined();
	});

	it("moves Claude sessions to review when the user interrupts a turn", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp",
			prompt: "",
			workspaceId: "workspace-1",
		});
		const detectOutputTransition = launch.detectOutputTransition;
		expect(detectOutputTransition).toBeDefined();
		if (!detectOutputTransition) {
			return;
		}

		const summary = createRunningSummary();
		expect(detectOutputTransition("\u001b[31mInterrupted\u001b[0m · What should", summary)).toBeNull();
		expect(detectOutputTransition(" Claude do instead?", summary)).toEqual({ type: "hook.to_review" });
	});

	it("does not treat generic Claude interruption text as a cancelled turn", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-1",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp",
			prompt: "",
			workspaceId: "workspace-1",
		});

		expect(launch.detectOutputTransition?.("[Request interrupted by user]", createRunningSummary())).toBeNull();
	});

	it("defers Codex plan-mode startup input", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-plan",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp",
			prompt: "Audit the deployment pipeline",
			startInPlanMode: true,
		});

		expect(launch.args).not.toContain("Audit the deployment pipeline");
		expect(launch.deferredStartupInput).toContain("/plan Audit the deployment pipeline");
		expect(launch.deferredStartupInput?.endsWith("\r")).toBe(true);
	});

	it("adds resume flags for Claude and Codex", async () => {
		setupTempHome();
		const codexLaunch = await prepareAgentLaunch({
			taskId: "task-codex",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp",
			prompt: "",
			resumeFromTrash: true,
		});
		expect(codexLaunch.args).toEqual(expect.arrayContaining(["resume", "--last"]));

		const claudeLaunch = await prepareAgentLaunch({
			taskId: "task-claude",
			agentId: "claude",
			binary: "claude",
			args: [],
			cwd: "/tmp",
			prompt: "",
			resumeFromTrash: true,
		});
		expect(claudeLaunch.args).toContain("--continue");
	});

	it("places Codex hook config before the resume subcommand", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-codex-resume-hooks",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp",
			prompt: "",
			resumeFromTrash: true,
			workspaceId: "workspace-1",
		});

		const resumeIndex = launch.args.indexOf("resume");
		for (const key of ["features.hooks", "hooks.state", "hooks.UserPromptSubmit", "hooks.Stop"]) {
			const configIndex = launch.args.findIndex((arg) => arg.startsWith(`${key}=`));
			expect(configIndex).toBeGreaterThan(-1);
			expect(configIndex).toBeLessThan(resumeIndex);
		}
	});

	it("forks and resumes explicit Codex sessions", async () => {
		setupTempHome();
		const forkLaunch = await prepareAgentLaunch({
			taskId: "task-codex-fork",
			agentId: "codex",
			binary: "codex",
			args: ["--cd", "/tmp/wrong-worktree"],
			cwd: "/tmp/fork",
			prompt: "Explore the alternative",
			codexForkSessionId: "source-session-id",
		});
		expect(forkLaunch.args.slice(-5)).toEqual([
			"-C",
			"/tmp/fork",
			"fork",
			"source-session-id",
			"Explore the alternative",
		]);

		const resumeLaunch = await prepareAgentLaunch({
			taskId: "task-codex-resume",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/resume",
			prompt: "Continue",
			codexResumeSessionId: "target-session-id",
		});
		expect(resumeLaunch.args.slice(-3)).toEqual(["resume", "target-session-id", "Continue"]);
		expect(resumeLaunch.args).not.toContain("--last");
	});

	it("forks and resumes explicit Claude sessions", async () => {
		setupTempHome();
		const forkLaunch = await prepareAgentLaunch({
			taskId: "task-claude-fork",
			agentId: "claude",
			binary: "claude",
			args: ["--continue", "--resume", "wrong-session-id", "--fork-session"],
			cwd: "/tmp/fork",
			prompt: "Explore the alternative",
			claudeForkSessionId: "source-session-id",
		});
		expect(forkLaunch.args.slice(-4)).toEqual([
			"--resume",
			"source-session-id",
			"--fork-session",
			"Explore the alternative",
		]);
		expect(forkLaunch.args).not.toContain("--continue");
		expect(forkLaunch.args).not.toContain("wrong-session-id");

		const resumeLaunch = await prepareAgentLaunch({
			taskId: "task-claude-resume",
			agentId: "claude",
			binary: "claude",
			args: ["--continue"],
			cwd: "/tmp/resume",
			prompt: "Continue",
			claudeResumeSessionId: "target-session-id",
		});
		expect(resumeLaunch.args.slice(-3)).toEqual(["--resume", "target-session-id", "Continue"]);
		expect(resumeLaunch.args).not.toContain("--continue");
		expect(resumeLaunch.args).not.toContain("--fork-session");
	});

	it("applies autonomous mode flags for Claude and Codex", async () => {
		setupTempHome();
		const claudeLaunch = await prepareAgentLaunch({
			taskId: "task-claude-auto",
			agentId: "claude",
			binary: "claude",
			args: [],
			autonomousModeEnabled: true,
			cwd: "/tmp",
			prompt: "",
		});
		expect(claudeLaunch.args).toContain("--dangerously-skip-permissions");
		expect(claudeLaunch.args).not.toContain("--permission-mode");
		expect(claudeLaunch.env.CLAUDE_CODE_ENABLE_AUTO_MODE).toBe("1");

		const codexLaunch = await prepareAgentLaunch({
			taskId: "task-codex-auto",
			agentId: "codex",
			binary: "codex",
			args: [],
			autonomousModeEnabled: true,
			cwd: "/tmp",
			prompt: "",
		});
		expect(codexLaunch.args).toContain("--dangerously-bypass-approvals-and-sandbox");
	});

	it("starts Claude plan mode without bypass flags", async () => {
		setupTempHome();
		const launch = await prepareAgentLaunch({
			taskId: "task-claude-plan",
			agentId: "claude",
			binary: "claude",
			args: ["--dangerously-skip-permissions"],
			autonomousModeEnabled: true,
			cwd: "/tmp",
			prompt: "",
			startInPlanMode: true,
		});
		expect(launch.args).not.toContain("--dangerously-skip-permissions");
		expect(launch.args).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
		expect(launch.env.CLAUDE_CODE_ENABLE_AUTO_MODE).toBe("1");
	});

	it("preserves explicit autonomous args when autonomous mode is disabled", async () => {
		setupTempHome();
		const claudeLaunch = await prepareAgentLaunch({
			taskId: "task-claude-no-auto",
			agentId: "claude",
			binary: "claude",
			args: ["--dangerously-skip-permissions"],
			autonomousModeEnabled: false,
			cwd: "/tmp",
			prompt: "",
		});
		expect(claudeLaunch.args).toContain("--dangerously-skip-permissions");

		const codexLaunch = await prepareAgentLaunch({
			taskId: "task-codex-no-auto",
			agentId: "codex",
			binary: "codex",
			args: ["--dangerously-bypass-approvals-and-sandbox"],
			autonomousModeEnabled: false,
			cwd: "/tmp",
			prompt: "",
		});
		expect(codexLaunch.args).toContain("--dangerously-bypass-approvals-and-sandbox");
	});
});
