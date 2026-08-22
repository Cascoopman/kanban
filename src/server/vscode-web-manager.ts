import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { connect, createServer } from "node:net";
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

async function resolveVsCodeServerLaunch(vsCodeCliPath: string): Promise<VsCodeServerLaunch> {
	const configuredPath = process.env.VSCODE_SERVER_CLI_PATH?.trim();
	if (configuredPath && (await isFileAvailable(configuredPath))) {
		return { executable: configuredPath, argumentPrefix: [], standalone: true };
	}
	return { executable: vsCodeCliPath, argumentPrefix: ["serve-web"], standalone: false };
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

function waitForPort(port: number, child: ChildProcess): Promise<void> {
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
				if (Date.now() - startedAt >= START_TIMEOUT_MS) {
					finish(new Error("VS Code Web did not start within 30 seconds."));
					return;
				}
				setTimeout(probe, 200);
			});
		};
		child.once("exit", handleExit);
		probe();
	});
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
	private readonly warn: (message: string) => void;

	constructor(options: { warn?: (message: string) => void } = {}) {
		this.warn = options.warn ?? (() => undefined);
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
		const executable = await resolveVsCodeCliPath();
		if (!executable) {
			return {
				status: "unavailable",
				url: null,
				workspacePath: null,
				error: "Visual Studio Code was not found. Install VS Code or expose its `code` command on PATH.",
			};
		}
		return { status: "consent_required", url: null, workspacePath: null };
	}

	async start(scope: RuntimeTrpcWorkspaceScope, input: RuntimeVsCodeWebRequest): Promise<RuntimeVsCodeWebResponse> {
		if (!input.acceptLicenseTerms) {
			return {
				status: "consent_required",
				url: null,
				workspacePath: null,
				error: "Accept the Visual Studio Code Server license terms before starting.",
			};
		}
		const executable = await resolveVsCodeCliPath();
		if (!executable) {
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
		let profile: Awaited<ReturnType<typeof prepareVsCodeWebProfile>>;
		try {
			profile = await prepareVsCodeWebProfile({ serverDataDirectory: serverDataDir });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.warn(`Could not synchronize the local VS Code profile: ${message}`);
			profile = { configurationDefaults: {} };
		}
		const launch = await resolveVsCodeServerLaunch(executable);
		const command = buildVsCodeServerCommand({
			launch,
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
		let diagnostic = "";
		const capture = (chunk: Buffer) => {
			diagnostic = `${diagnostic}${chunk.toString("utf8")}`.slice(-4_000);
		};
		child.stdout?.on("data", capture);
		child.stderr?.on("data", capture);
		try {
			await waitForPort(port, child);
			const proxy = await startVsCodeWebProxy({
				upstreamPort: port,
				configurationDefaults: profile.configurationDefaults,
			});
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
			return { status: "error", url: null, workspacePath, error: message };
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
}
