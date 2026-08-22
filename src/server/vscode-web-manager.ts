import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import treeKill from "tree-kill";

import type { RuntimeVsCodeWebRequest, RuntimeVsCodeWebResponse } from "../core/api-contract";
import { getRuntimeHomePath } from "../state/workspace-state";
import type { RuntimeTrpcWorkspaceScope } from "../trpc/app-router";
import { resolveTaskCwd } from "../workspace/task-worktree";
import { prepareVsCodeWebProfile } from "./vscode-web-profile";
import { startVsCodeWebProxy, type VsCodeWebProxy } from "./vscode-web-proxy";

const PROXY_BASE_PATH = "/vscode";
const START_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const VSCODE_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

export interface VsCodeServerLaunch {
	executable: string;
	argumentPrefix: string[];
	standalone: boolean;
}

interface ActiveVsCodeServer {
	key: string;
	workspacePath: string;
	port: number;
	token: string;
	process: ChildProcess;
	proxy: VsCodeWebProxy;
	lastError: string | null;
}

interface PreparedVsCodeWebRuntime {
	executable: string | null;
	launch: VsCodeServerLaunch | null;
	configurationDefaults: Record<string, unknown>;
}

async function isFileAvailable(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function resolveVsCodeCliPath(): Promise<string | null> {
	const configuredPath = process.env.VSCODE_CLI_PATH?.trim();
	const executableNames = process.platform === "win32" ? ["code.cmd", "code.exe", "code"] : ["code"];
	const pathCandidates = (process.env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.flatMap((directory) => executableNames.map((name) => join(directory, name)));
	const platformCandidates =
		process.platform === "darwin"
			? ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"]
			: process.platform === "win32"
				? [join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "bin", "code.cmd")]
				: ["/usr/local/bin/code", "/usr/bin/code", "/snap/bin/code"];

	for (const candidate of [configuredPath, ...pathCandidates, ...platformCandidates]) {
		if (candidate && (await isFileAvailable(candidate))) {
			return candidate;
		}
	}
	return null;
}

async function readProcessOutput(executable: string, args: string[]): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		const child = spawn(executable, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		const capture = (chunk: Buffer) => {
			output += chunk.toString("utf8");
		};
		child.stdout?.on("data", capture);
		child.stderr?.on("data", capture);
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) {
				resolve(output);
				return;
			}
			reject(new Error(`${executable} exited with code ${code ?? "signal"}.`));
		});
	});
}

export function parseVsCodeCommitId(versionOutput: string): string | null {
	return (
		versionOutput
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => VSCODE_COMMIT_PATTERN.test(line)) ?? null
	);
}

export function getDownloadedVsCodeServerCandidates(options: {
	commitId: string;
	homeDirectory?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
}): string[] {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const cliDataDirectory =
		env.VSCODE_CLI_DATA_DIR?.trim() || join(options.homeDirectory ?? homedir(), ".vscode", "cli");
	const binDirectory = join(cliDataDirectory, "serve-web", options.commitId, "bin");
	return platform === "win32"
		? [
				join(binDirectory, "code-server.cmd"),
				join(binDirectory, "code-server.exe"),
				join(binDirectory, "code-server"),
			]
		: [join(binDirectory, "code-server")];
}

async function resolveDownloadedVsCodeServerPath(vsCodeCliPath: string): Promise<string | null> {
	let versionOutput: string;
	try {
		versionOutput = await readProcessOutput(vsCodeCliPath, ["--version"]);
	} catch {
		return null;
	}
	const commitId = parseVsCodeCommitId(versionOutput);
	if (!commitId) {
		return null;
	}
	for (const candidate of getDownloadedVsCodeServerCandidates({ commitId })) {
		if (await isFileAvailable(candidate)) {
			return candidate;
		}
	}
	return null;
}

async function resolveVsCodeServerLaunch(vsCodeCliPath: string): Promise<VsCodeServerLaunch | null> {
	const configuredPath = process.env.VSCODE_SERVER_CLI_PATH?.trim();
	if (configuredPath && (await isFileAvailable(configuredPath))) {
		return { executable: configuredPath, argumentPrefix: [], standalone: true };
	}
	const downloadedPath = await resolveDownloadedVsCodeServerPath(vsCodeCliPath);
	return downloadedPath ? { executable: downloadedPath, argumentPrefix: [], standalone: true } : null;
}

async function reservePort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Could not reserve a port for VS Code Web."));
				return;
			}
			const port = address.port;
			server.close((error) => (error ? reject(error) : resolve(port)));
		});
	});
}

function waitForPort(port: number, child: ChildProcess, timeoutMs = START_TIMEOUT_MS): Promise<void> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			child.off("exit", handleExit);
			error ? reject(error) : resolve();
		};
		const handleExit = (code: number | null) =>
			finish(new Error(`VS Code Web exited before startup (${code ?? "signal"}).`));
		const probe = () => {
			if (settled) {
				return;
			}
			const socket = connect(port, "127.0.0.1");
			socket.once("connect", () => {
				socket.destroy();
				finish();
			});
			socket.once("error", () => {
				if (Date.now() - startedAt >= timeoutMs) {
					finish(new Error(`VS Code Web did not start within ${Math.ceil(timeoutMs / 1_000)} seconds.`));
					return;
				}
				setTimeout(probe, 200);
			});
		};
		child.once("exit", handleExit);
		probe();
	});
}

async function downloadVsCodeServer(
	vsCodeCliPath: string,
	serverDataDirectory: string,
	onProcess: (child: ChildProcess | null) => void,
): Promise<void> {
	const port = await reservePort();
	const command = buildVsCodeServerCommand({
		launch: { executable: vsCodeCliPath, argumentPrefix: ["serve-web"], standalone: false },
		port,
		token: randomBytes(32).toString("base64url"),
		serverDataDirectory,
		workspacePath: process.cwd(),
	});
	const child = spawn(command.executable, command.args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	onProcess(child);
	let diagnostic = "";
	const capture = (chunk: Buffer) => {
		diagnostic = `${diagnostic}${chunk.toString("utf8")}`.slice(-4_000);
	};
	child.stdout?.on("data", capture);
	child.stderr?.on("data", capture);
	try {
		await waitForPort(port, child, DOWNLOAD_TIMEOUT_MS);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(diagnostic.trim() || message);
	} finally {
		await terminateProcessTree(child);
		onProcess(null);
	}
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.killed) {
		return;
	}
	const exited = new Promise<void>((resolve) => {
		child.once("exit", () => resolve());
		setTimeout(resolve, 5_000);
	});
	const pid = child.pid;
	if (typeof pid === "number" && pid > 0) {
		await new Promise<void>((resolve) => {
			treeKill(pid, "SIGTERM", () => resolve());
		});
	} else {
		child.kill("SIGTERM");
	}
	await exited;
}

export function buildVsCodeServerCommand(options: {
	launch: VsCodeServerLaunch;
	port: number;
	token: string;
	serverDataDirectory: string;
	workspacePath: string;
}): { executable: string; args: string[] } {
	return {
		executable: options.launch.executable,
		args: [
			...options.launch.argumentPrefix,
			"--host",
			"127.0.0.1",
			"--port",
			String(options.port),
			"--connection-token",
			options.token,
			"--server-base-path",
			PROXY_BASE_PATH,
			"--server-data-dir",
			options.serverDataDirectory,
			"--default-folder",
			options.workspacePath,
			"--disable-telemetry",
			"--accept-server-license-terms",
			...(options.launch.standalone
				? [
						"--extensions-dir",
						join(options.serverDataDirectory, "extensions"),
						"--user-data-dir",
						join(options.serverDataDirectory, "data"),
						"--disable-workspace-trust",
					]
				: []),
		],
	};
}

function buildResponse(active: ActiveVsCodeServer): RuntimeVsCodeWebResponse {
	const payload = encodeURIComponent(JSON.stringify([["skipWelcome", "true"]]));
	return {
		status: active.lastError ? "error" : "ready",
		url: active.lastError
			? null
			: `http://127.0.0.1:${active.port}${PROXY_BASE_PATH}/?tkn=${encodeURIComponent(active.token)}&payload=${payload}`,
		workspacePath: active.workspacePath,
		error: active.lastError ?? undefined,
	};
}

export class VsCodeWebManager {
	private active: ActiveVsCodeServer | null = null;
	private preparation: Promise<PreparedVsCodeWebRuntime> | null = null;
	private preparationProcess: ChildProcess | null = null;
	private launchProcess: ChildProcess | null = null;
	private startOperation: { key: string; promise: Promise<RuntimeVsCodeWebResponse> } | null = null;
	private disposed = false;
	private readonly warn: (message: string) => void;

	constructor(options: { warn?: (message: string) => void } = {}) {
		this.warn = options.warn ?? (() => undefined);
	}

	private async prepareRuntime(): Promise<PreparedVsCodeWebRuntime> {
		const executable = await resolveVsCodeCliPath();
		if (!executable) {
			return { executable: null, launch: null, configurationDefaults: {} };
		}
		const serverDataDirectory = join(getRuntimeHomePath(), "vscode-web");
		await mkdir(serverDataDirectory, { recursive: true });
		let configurationDefaults: Record<string, unknown> = {};
		try {
			configurationDefaults = (await prepareVsCodeWebProfile({ serverDataDirectory })).configurationDefaults;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.warn(`Could not synchronize the local VS Code profile: ${message}`);
		}

		let launch = await resolveVsCodeServerLaunch(executable);
		if (!launch && !this.disposed) {
			try {
				await downloadVsCodeServer(executable, serverDataDirectory, (child) => {
					this.preparationProcess = child;
				});
				launch = await resolveVsCodeServerLaunch(executable);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.warn(`Could not pre-download VS Code Server: ${message}`);
			}
		}
		return {
			executable,
			launch: launch ?? { executable, argumentPrefix: ["serve-web"], standalone: false },
			configurationDefaults,
		};
	}

	private async getPreparedRuntime(): Promise<PreparedVsCodeWebRuntime> {
		this.preparation ??= this.prepareRuntime();
		const prepared = await this.preparation;
		if (!prepared.executable) {
			this.preparation = null;
		}
		return prepared;
	}

	async prewarm(): Promise<void> {
		await this.getPreparedRuntime();
	}

	async getStatus(
		scope: RuntimeTrpcWorkspaceScope,
		input: RuntimeVsCodeWebRequest,
	): Promise<RuntimeVsCodeWebResponse> {
		const key = `${scope.workspaceId}:${input.taskId}`;
		if (this.active?.key === key && this.active.process.exitCode === null && !this.active.process.killed) {
			return buildResponse(this.active);
		}
		if (this.active?.key === key && this.active.lastError) {
			return buildResponse(this.active);
		}
		const prepared = await this.getPreparedRuntime();
		if (!prepared.executable) {
			return {
				status: "unavailable",
				url: null,
				workspacePath: null,
				error: "Visual Studio Code was not found. Install VS Code or expose its `code` command on PATH.",
			};
		}
		return { status: "idle", url: null, workspacePath: null };
	}

	private async startPrepared(
		scope: RuntimeTrpcWorkspaceScope,
		input: RuntimeVsCodeWebRequest,
	): Promise<RuntimeVsCodeWebResponse> {
		if (this.disposed) {
			return { status: "error", url: null, workspacePath: null, error: "VS Code Web is shutting down." };
		}
		const prepared = await this.getPreparedRuntime();
		if (!prepared.executable || !prepared.launch) {
			return await this.getStatus(scope, input);
		}
		const key = `${scope.workspaceId}:${input.taskId}`;
		if (this.active?.key === key && this.active.process.exitCode === null && !this.active.process.killed) {
			return buildResponse(this.active);
		}

		await this.stop();
		const workspacePath = await resolveTaskCwd({
			cwd: scope.workspacePath,
			taskId: input.taskId,
			baseRef: input.baseRef,
			ensure: true,
		});
		const port = await reservePort();
		const token = randomBytes(32).toString("base64url");
		const serverDataDir = join(getRuntimeHomePath(), "vscode-web");
		await mkdir(serverDataDir, { recursive: true });
		const command = buildVsCodeServerCommand({
			launch: prepared.launch,
			port,
			token,
			serverDataDirectory: serverDataDir,
			workspacePath,
		});
		const child = spawn(command.executable, command.args, {
			cwd: workspacePath,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.launchProcess = child;
		let diagnostic = "";
		const capture = (chunk: Buffer) => {
			diagnostic = `${diagnostic}${chunk.toString("utf8")}`.slice(-4_000);
		};
		child.stdout?.on("data", capture);
		child.stderr?.on("data", capture);
		try {
			await waitForPort(port, child);
			if (this.disposed) {
				throw new Error("VS Code Web is shutting down.");
			}
			const proxy = await startVsCodeWebProxy({
				upstreamPort: port,
				configurationDefaults: prepared.configurationDefaults,
			});
			if (this.disposed) {
				await proxy.close();
				throw new Error("VS Code Web is shutting down.");
			}
			const active: ActiveVsCodeServer = {
				key,
				workspacePath,
				port: proxy.port,
				token,
				process: child,
				proxy,
				lastError: null,
			};
			this.active = active;
			this.launchProcess = null;
			child.once("exit", (code) => {
				if (this.active === active && !active.process.killed) {
					active.lastError = diagnostic.trim() || `VS Code Web exited (${code ?? "signal"}).`;
					void active.proxy.close();
				}
			});
			return buildResponse(active);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await terminateProcessTree(child);
			if (this.launchProcess === child) {
				this.launchProcess = null;
			}
			return { status: "error", url: null, workspacePath, error: message };
		}
	}

	async start(scope: RuntimeTrpcWorkspaceScope, input: RuntimeVsCodeWebRequest): Promise<RuntimeVsCodeWebResponse> {
		const key = `${scope.workspaceId}:${input.taskId}`;
		if (this.startOperation?.key === key) {
			return await this.startOperation.promise;
		}
		const previousOperation = this.startOperation?.promise;
		const promise = (async () => {
			if (previousOperation) {
				await previousOperation.catch(() => undefined);
			}
			return await this.startPrepared(scope, input);
		})();
		this.startOperation = { key, promise };
		try {
			return await promise;
		} finally {
			if (this.startOperation?.promise === promise) {
				this.startOperation = null;
			}
		}
	}

	async stop(): Promise<void> {
		const active = this.active;
		this.active = null;
		if (!active || active.process.exitCode !== null || active.process.killed) {
			await active?.proxy.close();
			return;
		}
		await active.proxy.close();
		await terminateProcessTree(active.process);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		const preparationProcess = this.preparationProcess;
		const launchProcess = this.launchProcess;
		this.preparationProcess = null;
		this.launchProcess = null;
		if (preparationProcess) {
			await terminateProcessTree(preparationProcess);
		}
		if (launchProcess) {
			await terminateProcessTree(launchProcess);
		}
		await this.startOperation?.promise.catch(() => undefined);
		await this.stop();
	}
}
