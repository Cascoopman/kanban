import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { delimiter, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

const requireFromHere = createRequire(import.meta.url);

function resolveShutdownIpcHookPath(): string {
	return resolve(process.cwd(), "test/integration/shutdown-ipc-hook.cjs");
}

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

function initGitRepository(path: string): void {
	const init = spawnSync("git", ["init"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (init.status !== 0) {
		throw new Error(`Failed to initialize git repository at ${path}`);
	}
	const checkout = spawnSync("git", ["checkout", "-B", "main"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (checkout.status !== 0) {
		throw new Error(`Failed to create main branch at ${path}`);
	}
}

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function commitAll(cwd: string, message: string): string {
	runGit(cwd, ["add", "."]);
	runGit(cwd, ["commit", "-qm", message]);
	return runGit(cwd, ["rev-parse", "HEAD"]);
}

async function getAvailablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => {
			resolveListen();
		});
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : null;
	await new Promise<void>((resolveClose, rejectClose) => {
		server.close((error) => {
			if (error) {
				rejectClose(error);
				return;
			}
			resolveClose();
		});
	});
	if (!port) {
		throw new Error("Could not allocate a test port.");
	}
	return port;
}

async function waitForServerStart(process: ChildProcess, timeoutMs = 10_000): Promise<void> {
	await new Promise<void>((resolveStart, rejectStart) => {
		if (!process.stdout || !process.stderr) {
			rejectStart(new Error("Expected child process stdout/stderr pipes to be available."));
			return;
		}
		let settled = false;
		let stdout = "";
		let stderr = "";
		const timeoutId = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			rejectStart(new Error(`Timed out waiting for server start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
		}, timeoutMs);
		const handleOutput = (chunk: Buffer, source: "stdout" | "stderr") => {
			const text = chunk.toString();
			if (source === "stdout") {
				stdout += text;
			} else {
				stderr += text;
			}
			if (!stdout.includes("Kanban running at ") || settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			resolveStart();
		};
		process.stdout.on("data", (chunk: Buffer) => {
			handleOutput(chunk, "stdout");
		});
		process.stderr.on("data", (chunk: Buffer) => {
			handleOutput(chunk, "stderr");
		});
		process.once("exit", (code, signal) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			rejectStart(
				new Error(
					`Server process exited before startup (code=${String(code)} signal=${String(signal)}).\nstdout:\n${stdout}\nstderr:\n${stderr}`,
				),
			);
		});
	});
}

function installBrowserOpenStub(binDir: string, logPath: string): void {
	mkdirSync(binDir, { recursive: true });
	const script = `#!/usr/bin/env sh
printf '%s\n' "$*" >> ${JSON.stringify(logPath)}
`;
	const commandNames = process.platform === "darwin" ? ["open"] : ["xdg-open"];
	for (const commandName of commandNames) {
		const scriptPath = join(binDir, commandName);
		writeFileSync(scriptPath, script, "utf8");
		chmodSync(scriptPath, 0o755);
	}
}

function installAgentStub(binDir: string): void {
	mkdirSync(binDir, { recursive: true });
	if (process.platform === "win32") {
		writeFileSync(
			join(binDir, "codex.cmd"),
			"@echo off\r\n:loop\r\nping -n 2 127.0.0.1 >nul\r\ngoto loop\r\n",
			"utf8",
		);
		return;
	}
	const scriptPath = join(binDir, "codex");
	writeFileSync(scriptPath, "#!/bin/sh\nwhile :; do sleep 1; done\n", "utf8");
	chmodSync(scriptPath, 0o755);
}

function installRecordingAgentStubs(binDir: string, logPath: string): void {
	mkdirSync(binDir, { recursive: true });
	const script = `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n");
setInterval(() => {}, 1000);
`;
	for (const commandName of ["claude", "codex"]) {
		const scriptPath = join(binDir, commandName);
		writeFileSync(scriptPath, script, "utf8");
		chmodSync(scriptPath, 0o755);
	}
}

function readAgentLaunches(logPath: string): Array<{ cwd: string; args: string[] }> {
	if (!existsSync(logPath)) {
		return [];
	}
	return readFileSync(logPath, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { cwd: string; args: string[] });
}

async function waitForAgentLaunchCount(logPath: string, expectedCount: number, timeoutMs = 5_000): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (readAgentLaunches(logPath).length >= expectedCount) {
			return;
		}
		await new Promise<void>((resolveWait) => {
			setTimeout(resolveWait, 25);
		});
	}
	throw new Error(`Timed out waiting for ${expectedCount} agent launches.`);
}

function writeAgentSessionFixture(options: {
	agentId: "claude" | "codex";
	homeDir: string;
	cwd: string;
	sessionId: string;
}): void {
	if (options.agentId === "codex") {
		const sessionsDir = join(options.homeDir, ".codex", "sessions", "2026", "08", "22");
		mkdirSync(sessionsDir, { recursive: true });
		writeFileSync(
			join(sessionsDir, "rollout-2026-08-22T12-00-00-source.jsonl"),
			`${JSON.stringify({
				type: "session_meta",
				payload: { id: options.sessionId, cwd: options.cwd, source: "cli" },
			})}\n`,
			"utf8",
		);
		return;
	}

	const projectDir = join(options.homeDir, ".claude", "projects", "source-task");
	mkdirSync(projectDir, { recursive: true });
	writeFileSync(
		join(projectDir, `${options.sessionId}.jsonl`),
		[
			JSON.stringify({ type: "last-prompt", sessionId: options.sessionId }),
			JSON.stringify({
				type: "user",
				cwd: options.cwd,
				sessionId: options.sessionId,
				isSidechain: false,
			}),
		].join("\n"),
		"utf8",
	);
}

function readBrowserOpenLog(logPath: string): string[] {
	if (!existsSync(logPath)) {
		return [];
	}
	return readFileSync(logPath, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

async function waitForBrowserOpenCount(logPath: string, expectedCount: number, timeoutMs = 2_000): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (readBrowserOpenLog(logPath).length >= expectedCount) {
			return;
		}
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 25);
		});
	}
	throw new Error(
		`Timed out waiting for browser open count ${expectedCount}. Current log: ${readBrowserOpenLog(logPath).join(", ")}`,
	);
}

async function waitForExit(process: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (process.exitCode !== null) {
		return true;
	}

	return await new Promise<boolean>((resolveExit) => {
		const handleExit = () => {
			clearTimeout(timeoutId);
			resolveExit(true);
		};
		const timeoutId = setTimeout(() => {
			process.removeListener("exit", handleExit);
			resolveExit(false);
		}, timeoutMs);
		process.once("exit", handleExit);
	});
}

async function requestGracefulShutdown(process: ChildProcess): Promise<void> {
	if (typeof process.send !== "function" || !process.connected) {
		process.kill("SIGINT");
		return;
	}

	await new Promise<void>((resolveSend) => {
		process.send?.({ type: "kanban.shutdown" }, () => {
			resolveSend();
		});
	});
}

function spawnSourceCli(
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; stdio?: ChildProcess["stdio"] },
) {
	const cliEntrypoint = resolve(process.cwd(), "src/cli.ts");
	return spawn(process.execPath, ["--import", resolveTsxLoaderImportSpecifier(), cliEntrypoint, ...args], {
		cwd: options.cwd,
		env: options.env,
		stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
	});
}

async function runCliCommandAndCollectOutput(options: {
	args: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null; didExit: boolean }> {
	const process = spawnSourceCli(options.args, {
		cwd: options.cwd,
		env: options.env,
	});

	let stdout = "";
	let stderr = "";
	process.stdout?.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	process.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});

	const didExit = await waitForExit(process, options.timeoutMs ?? 8_000);
	if (!didExit) {
		process.kill("SIGKILL");
	}

	return {
		stdout,
		stderr,
		exitCode: process.exitCode,
		didExit,
	};
}

describe("source task commands", () => {
	for (const agentId of ["codex", "claude"] as const) {
		it(
			`lets a running ${agentId} task branch itself with worktree and conversation context`,
			{ timeout: 120_000 },
			async () => {
				if (process.platform === "win32") {
					return;
				}

				const { path: homeDir, cleanup: cleanupHome } = createTempDir(`kanban-home-task-branch-${agentId}-`);
				const { path: projectPath, cleanup: cleanupProject } = createTempDir(
					`kanban-project-task-branch-${agentId}-`,
				);

				try {
					initGitRepository(projectPath);
					writeFileSync(join(projectPath, "README.md"), `# ${agentId} branch test\n`, "utf8");
					commitAll(projectPath, "init");

					const port = String(await getAvailablePort());
					const agentBinDir = join(homeDir, "agent-bin");
					const agentLogPath = join(homeDir, "agent-launches.jsonl");
					installRecordingAgentStubs(agentBinDir, agentLogPath);
					const env = createGitTestEnv({
						HOME: homeDir,
						USERPROFILE: homeDir,
						KANBAN_RUNTIME_PORT: port,
						PATH: `${agentBinDir}${delimiter}${process.env.PATH ?? ""}`,
					});

					const serverProcess = spawn(
						process.execPath,
						[
							"--require",
							resolveShutdownIpcHookPath(),
							"--import",
							resolveTsxLoaderImportSpecifier(),
							resolve(process.cwd(), "src/cli.ts"),
							"--no-open",
						],
						{
							cwd: projectPath,
							env,
							stdio: ["ignore", "pipe", "pipe", "ipc"],
						},
					);

					try {
						await waitForServerStart(serverProcess);
						const created = await runCliCommandAndCollectOutput({
							args: [
								"task",
								"create",
								"--title",
								`${agentId} source task`,
								"--agent-id",
								agentId,
								"--project-path",
								projectPath,
							],
							cwd: projectPath,
							env,
							timeoutMs: 20_000,
						});
						expect(
							created.didExit,
							`Task creation did not exit.\nstdout:\n${created.stdout}\nstderr:\n${created.stderr}`,
						).toBe(true);
						expect(created.exitCode, `stdout:\n${created.stdout}\nstderr:\n${created.stderr}`).toBe(0);
						const createdPayload = JSON.parse(created.stdout) as { task?: { id?: string } };
						const sourceTaskId = createdPayload.task?.id;
						if (!sourceTaskId) {
							throw new Error(`Task creation did not return an id.\n${created.stdout}`);
						}

						await waitForAgentLaunchCount(agentLogPath, 1);
						const sourceLaunch = readAgentLaunches(agentLogPath)[0];
						if (!sourceLaunch) {
							throw new Error("Source agent launch was not recorded.");
						}
						writeFileSync(join(sourceLaunch.cwd, "branch-working-copy.txt"), "copied into branch\n", "utf8");
						const sourceWorkspacePath = join(homeDir, relative(realpathSync(homeDir), sourceLaunch.cwd));
						const sourceSessionId = `${agentId}-source-session-id`;
						writeAgentSessionFixture({
							agentId,
							homeDir,
							cwd: sourceWorkspacePath,
							sessionId: sourceSessionId,
						});

						const workspaceIndex = JSON.parse(
							readFileSync(join(homeDir, ".kanban", "workspaces", "index.json"), "utf8"),
						) as { entries?: Record<string, { workspaceId?: string }> };
						const workspaceId = Object.values(workspaceIndex.entries ?? {})[0]?.workspaceId;
						if (!workspaceId) {
							throw new Error(`Could not resolve workspace id for ${projectPath}.`);
						}
						const taskSessionEnv = createGitTestEnv({
							...env,
							KANBAN_TASK_ID: sourceTaskId,
							KANBAN_WORKSPACE_ID: workspaceId,
						});
						const prompt = `Explore the ${agentId} alternative`;
						const branched = await runCliCommandAndCollectOutput({
							args: ["task", "branch", "--title", `${agentId} branch task`, "--prompt", prompt],
							cwd: sourceLaunch.cwd,
							env: taskSessionEnv,
							timeoutMs: 30_000,
						});
						expect(
							branched.didExit,
							`Task branch did not exit.\nstdout:\n${branched.stdout}\nstderr:\n${branched.stderr}`,
						).toBe(true);
						expect(branched.exitCode).toBe(0);
						const branchedPayload = JSON.parse(branched.stdout) as {
							ok?: boolean;
							task?: { id?: string; workspacePath?: string; branchedFromTaskId?: string };
						};
						expect(branchedPayload.ok).toBe(true);
						expect(branchedPayload.task?.branchedFromTaskId).toBe(sourceTaskId);
						const targetWorkspacePath = branchedPayload.task?.workspacePath;
						if (!targetWorkspacePath) {
							throw new Error(`Task branch did not return its workspace path.\n${branched.stdout}`);
						}

						await waitForAgentLaunchCount(agentLogPath, 2);
						const targetLaunch = readAgentLaunches(agentLogPath).at(-1);
						if (!targetLaunch) {
							throw new Error("Target agent launch was not recorded.");
						}
						expect(realpathSync(targetLaunch.cwd)).toBe(realpathSync(targetWorkspacePath));
						expect(readFileSync(join(targetWorkspacePath, "branch-working-copy.txt"), "utf8")).toBe(
							"copied into branch\n",
						);
						expect(targetLaunch.args).toContain(prompt);
						if (agentId === "codex") {
							expect(targetLaunch.args).toEqual(
								expect.arrayContaining(["-C", targetWorkspacePath, "fork", sourceSessionId]),
							);
						} else {
							expect(targetLaunch.args).toEqual(
								expect.arrayContaining(["--resume", sourceSessionId, "--fork-session"]),
							);
							expect(targetLaunch.args).not.toContain("--continue");
						}
					} finally {
						await requestGracefulShutdown(serverProcess);
						const stopped = await waitForExit(serverProcess, 5_000);
						if (!stopped) {
							serverProcess.kill("SIGKILL");
							await waitForExit(serverProcess, 5_000);
						}
					}
				} finally {
					cleanupProject();
					cleanupHome();
				}
			},
		);
	}

	it("exits after creating a task when the runtime server is already running", { timeout: 60_000 }, async () => {
		const { path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-home-task-exit-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-task-exit-");

		try {
			initGitRepository(projectPath);
			writeFileSync(join(projectPath, "README.md"), "# Task Exit Test\n", "utf8");
			commitAll(projectPath, "init");

			const port = String(await getAvailablePort());
			const agentBinDir = join(homeDir, "agent-bin");
			installAgentStub(agentBinDir);
			const env = createGitTestEnv({
				HOME: homeDir,
				USERPROFILE: homeDir,
				KANBAN_RUNTIME_PORT: port,
				PATH: `${agentBinDir}${delimiter}${process.env.PATH ?? ""}`,
			});

			const serverProcess = spawn(
				process.execPath,
				[
					"--require",
					resolveShutdownIpcHookPath(),
					"--import",
					resolveTsxLoaderImportSpecifier(),
					resolve(process.cwd(), "src/cli.ts"),
					"--no-open",
				],
				{
					cwd: projectPath,
					env,
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);

			try {
				await waitForServerStart(serverProcess);

				const commandProcess = spawnSourceCli(
					[
						"task",
						"create",
						"--title",
						"Add a demo banner to the homepage that displays a welcome message and weather summary",
						"--agent-id",
						"codex",
						"--project-path",
						projectPath,
					],
					{
						cwd: projectPath,
						env,
					},
				);

				let stdout = "";
				let stderr = "";
				commandProcess.stdout?.on("data", (chunk: Buffer) => {
					stdout += chunk.toString();
				});
				commandProcess.stderr?.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});

				const didExit = await waitForExit(commandProcess, 8_000);
				if (!didExit) {
					commandProcess.kill("SIGKILL");
				}

				expect(didExit, `task create did not exit in time.\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(true);
				expect(commandProcess.exitCode).toBe(0);
				expect(stdout).toContain('"ok": true');

				const createdPayload = JSON.parse(stdout) as { task?: { id?: string } };
				const taskId = createdPayload.task?.id;
				if (!taskId) {
					throw new Error(`task create did not return an id.\nstdout:\n${stdout}`);
				}
				const workspaceIndex = JSON.parse(
					readFileSync(join(homeDir, ".kanban", "workspaces", "index.json"), "utf8"),
				) as { entries?: Record<string, { workspaceId?: string }> };
				const workspaceId = Object.values(workspaceIndex.entries ?? {})[0]?.workspaceId;
				if (!workspaceId) {
					throw new Error(`Could not resolve workspace id for ${projectPath}.`);
				}
				const taskSessionEnv = createGitTestEnv({
					...env,
					KANBAN_TASK_ID: taskId,
					KANBAN_WORKSPACE_ID: workspaceId,
				});

				const current = await runCliCommandAndCollectOutput({
					args: ["task", "whoami"],
					cwd: homeDir,
					env: taskSessionEnv,
				});
				expect(current.didExit, `task whoami did not exit.\nstdout:\n${current.stdout}`).toBe(true);
				expect(current.exitCode).toBe(0);
				expect(current.stdout).toContain(`"id": "${taskId}"`);

				const updatedTitle = "Implement prompt-first task creation";
				const updated = await runCliCommandAndCollectOutput({
					args: ["task", "update", "--title", updatedTitle],
					cwd: homeDir,
					env: taskSessionEnv,
				});
				expect(updated.didExit, `task update did not exit.\nstdout:\n${updated.stdout}`).toBe(true);
				expect(updated.exitCode).toBe(0);
				expect(updated.stdout).toContain(`"title": "${updatedTitle}"`);
			} finally {
				await requestGracefulShutdown(serverProcess);
				const stopped = await waitForExit(serverProcess, 5_000);
				if (!stopped) {
					serverProcess.kill("SIGKILL");
					await waitForExit(serverProcess, 5_000);
				}
			}
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("opens only for launch invocations", { timeout: 90_000 }, async () => {
		if (process.platform === "win32") {
			return;
		}

		const { path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-home-root-launch-open-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-root-launch-open-");

		try {
			initGitRepository(projectPath);
			writeFileSync(join(projectPath, "README.md"), "# Root Launch Browser Open Test\n", "utf8");
			commitAll(projectPath, "init");

			const port = String(await getAvailablePort());
			const browserStubBinDir = join(homeDir, "browser-bin");
			const browserOpenLogPath = join(homeDir, "browser-open.log");
			installBrowserOpenStub(browserStubBinDir, browserOpenLogPath);
			const env = createGitTestEnv({
				HOME: homeDir,
				USERPROFILE: homeDir,
				KANBAN_RUNTIME_PORT: port,
				PATH: `${browserStubBinDir}:${process.env.PATH ?? ""}`,
			});

			const serverProcess = spawn(
				process.execPath,
				[
					"--require",
					resolveShutdownIpcHookPath(),
					"--import",
					resolveTsxLoaderImportSpecifier(),
					resolve(process.cwd(), "src/cli.ts"),
					"--no-open",
				],
				{
					cwd: projectPath,
					env,
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);

			try {
				await waitForServerStart(serverProcess);

				for (const [args, expectedOpenCount] of [
					[[], 1],
					[["task", "list", "--project-path", projectPath], 1],
					[["--agent", "codex"], 2],
					[["--port", port], 3],
				] as const) {
					const result = await runCliCommandAndCollectOutput({
						args: [...args],
						cwd: projectPath,
						env,
						timeoutMs: 15_000,
					});
					expect(
						result.didExit,
						`CLI did not exit for args ${JSON.stringify(args)}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
					).toBe(true);
					expect(result.exitCode).toBe(0);
					await waitForBrowserOpenCount(browserOpenLogPath, expectedOpenCount);
					expect(readBrowserOpenLog(browserOpenLogPath)).toHaveLength(expectedOpenCount);
				}
			} finally {
				await requestGracefulShutdown(serverProcess);
				const stopped = await waitForExit(serverProcess, 5_000);
				if (!stopped) {
					serverProcess.kill("SIGKILL");
					await waitForExit(serverProcess, 5_000);
				}
			}
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("supports done and trash aliases when moving and deleting tasks", { timeout: 60_000 }, async () => {
		const { path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-home-task-done-delete-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-task-done-delete-");

		try {
			initGitRepository(projectPath);
			writeFileSync(join(projectPath, "README.md"), "# Task Done Delete Test\n", "utf8");
			commitAll(projectPath, "init");

			const port = String(await getAvailablePort());
			const agentBinDir = join(homeDir, "agent-bin");
			installAgentStub(agentBinDir);
			const env = createGitTestEnv({
				HOME: homeDir,
				USERPROFILE: homeDir,
				KANBAN_RUNTIME_PORT: port,
				PATH: `${agentBinDir}${delimiter}${process.env.PATH ?? ""}`,
			});

			const serverProcess = spawn(
				process.execPath,
				[
					"--require",
					resolveShutdownIpcHookPath(),
					"--import",
					resolveTsxLoaderImportSpecifier(),
					resolve(process.cwd(), "src/cli.ts"),
					"--no-open",
				],
				{
					cwd: projectPath,
					env,
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);

			try {
				await waitForServerStart(serverProcess);

				const taskIds: string[] = [];
				for (const title of [
					"Create a temporary task for done and delete",
					"Create another temporary task for done and delete",
					"Create a legacy trash command task for done and delete",
				]) {
					const created = await runCliCommandAndCollectOutput({
						args: ["task", "create", "--title", title, "--agent-id", "codex", "--project-path", projectPath],
						cwd: projectPath,
						env,
					});
					expect(
						created.didExit,
						`task create did not exit in time.\nstdout:\n${created.stdout}\nstderr:\n${created.stderr}`,
					).toBe(true);
					expect(created.exitCode).toBe(0);

					const createdPayload = JSON.parse(created.stdout) as {
						ok?: boolean;
						task?: { id?: string };
					};
					expect(createdPayload.ok).toBe(true);
					expect(typeof createdPayload.task?.id).toBe("string");
					if (createdPayload.task?.id) {
						taskIds.push(createdPayload.task.id);
					}
				}
				expect(taskIds).toHaveLength(3);

				const movedByDoneAlias = await runCliCommandAndCollectOutput({
					args: ["task", "done", "--task-id", taskIds[0] ?? "", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					movedByDoneAlias.didExit,
					`task done did not exit in time.\nstdout:\n${movedByDoneAlias.stdout}\nstderr:\n${movedByDoneAlias.stderr}`,
				).toBe(true);
				expect(movedByDoneAlias.exitCode).toBe(0);
				expect(movedByDoneAlias.stdout).toContain('"ok": true');

				const movedByTrashCommand = await runCliCommandAndCollectOutput({
					args: ["task", "trash", "--column", "in_progress", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					movedByTrashCommand.didExit,
					`task trash did not exit in time.\nstdout:\n${movedByTrashCommand.stdout}\nstderr:\n${movedByTrashCommand.stderr}`,
				).toBe(true);
				expect(movedByTrashCommand.exitCode).toBe(0);
				expect(movedByTrashCommand.stdout).toContain('"ok": true');
				expect(movedByTrashCommand.stdout).toContain('"column": "in_progress"');
				expect(movedByTrashCommand.stdout).toContain('"count": 2');

				const listedDoneBeforeDelete = await runCliCommandAndCollectOutput({
					args: ["task", "list", "--column", "done", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					listedDoneBeforeDelete.didExit,
					`task list --column done did not exit in time.\nstdout:\n${listedDoneBeforeDelete.stdout}\nstderr:\n${listedDoneBeforeDelete.stderr}`,
				).toBe(true);
				expect(listedDoneBeforeDelete.exitCode).toBe(0);
				expect(listedDoneBeforeDelete.stdout).toContain('"count": 3');

				const listedTrashBeforeDelete = await runCliCommandAndCollectOutput({
					args: ["task", "list", "--column", "trash", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					listedTrashBeforeDelete.didExit,
					`task list --column trash did not exit in time.\nstdout:\n${listedTrashBeforeDelete.stdout}\nstderr:\n${listedTrashBeforeDelete.stderr}`,
				).toBe(true);
				expect(listedTrashBeforeDelete.exitCode).toBe(0);
				expect(listedTrashBeforeDelete.stdout).toContain('"count": 3');

				const deletedDone = await runCliCommandAndCollectOutput({
					args: ["task", "delete", "--column", "done", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					deletedDone.didExit,
					`task delete --column done did not exit in time.\nstdout:\n${deletedDone.stdout}\nstderr:\n${deletedDone.stderr}`,
				).toBe(true);
				expect(deletedDone.exitCode).toBe(0);
				expect(deletedDone.stdout).toContain('"ok": true');
				expect(deletedDone.stdout).toContain('"column": "trash"');
				expect(deletedDone.stdout).toContain('"count": 3');

				const listedTrash = await runCliCommandAndCollectOutput({
					args: ["task", "list", "--column", "trash", "--project-path", projectPath],
					cwd: projectPath,
					env,
				});
				expect(
					listedTrash.didExit,
					`task list --column trash did not exit in time.\nstdout:\n${listedTrash.stdout}\nstderr:\n${listedTrash.stderr}`,
				).toBe(true);
				expect(listedTrash.exitCode).toBe(0);
				expect(listedTrash.stdout).toContain('"count": 0');
			} finally {
				await requestGracefulShutdown(serverProcess);
				const stopped = await waitForExit(serverProcess, 5_000);
				if (!stopped) {
					serverProcess.kill("SIGKILL");
					await waitForExit(serverProcess, 5_000);
				}
			}
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});
});
