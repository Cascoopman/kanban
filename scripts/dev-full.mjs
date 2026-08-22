/**
 * Starts both the runtime server and Vite web UI dev server on an
 * automatically-selected free port. Use via `npm run dev:full` or the
 * VS Code "Dev (Full Stack)" launch config.
 */
import { createServer, connect } from "node:net";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { buildAgentRuntimeEnv } from "./agent-runtime-env.mjs";

const isWindows = process.platform === "win32";
const repoRoot = process.cwd();

async function ensureDependenciesInstalled() {
	const lockIndicator = join(repoRoot, "node_modules", ".package-lock.json");
	try {
		await access(lockIndicator);
		return;
	} catch {
		// node_modules is missing; fall through to install below.
	}
	console.warn("node_modules not installed in this worktree. Running npm ci...");
	for (const args of [["ci"], ["--prefix", "web-ui", "ci"]]) {
		const result = spawnSync("npm", args, { stdio: "inherit", shell: isWindows });
		if (result.status !== 0) {
			process.exit(result.status ?? 1);
		}
	}
}

// Must run before importing any third-party modules so a fresh worktree with
// an empty node_modules can bootstrap itself using only node: built-ins.
await ensureDependenciesInstalled();

// Deferred until after ensureDependenciesInstalled so these resolve against
// the freshly-installed node_modules. Static top-level imports would be
// resolved before any code runs and fail with ERR_MODULE_NOT_FOUND.
const { default: treeKill } = await import("tree-kill");
const { default: open } = await import("open");

function findPort(start, reserved = new Set()) {
	if (reserved.has(start)) {
		return findPort(start + 1, reserved);
	}
	return new Promise((resolve) => {
		const srv = createServer();
		srv.listen(start, "127.0.0.1", () => {
			srv.close(() => resolve(start));
		});
		srv.on("error", () => resolve(findPort(start + 1, reserved)));
	});
}

function waitForPort(port, timeout = 15000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		function attempt() {
			const sock = connect(port, "127.0.0.1");
			sock.on("connect", () => {
				sock.destroy();
				resolve();
			});
			sock.on("error", () => {
				if (Date.now() - start > timeout) {
					reject(new Error(`Runtime did not start within ${timeout}ms`));
				} else {
					setTimeout(attempt, 200);
				}
			});
		}
		attempt();
	});
}

function getDefaultDevRuntimeHome() {
	const workspacePath = resolve(repoRoot);
	const workspaceHash = createHash("sha256").update(workspacePath).digest("hex").slice(0, 10);
	return join(homedir(), ".kanban-dev", `${basename(workspacePath)}-${workspaceHash}`);
}

function resolveRuntimeHomeInput(value) {
	if (value === "~") {
		return homedir();
	}
	if (value.startsWith("~/") || value.startsWith("~\\")) {
		return resolve(homedir(), value.slice(2));
	}
	return resolve(value);
}

function parsePort(value, flag) {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`${flag} requires an integer between 1 and 65535.`);
	}
	return port;
}

function parseDevFullArgs(args) {
	let runtimeHome = null;
	let useProductionState = false;
	let requestedRuntimePort = null;
	let requestedWebUiPort = null;
	let projectPath = null;
	let openBrowser = true;
	const runtimeArgs = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--use-production-state") {
			useProductionState = true;
			continue;
		}
		if (arg === "--no-browser" || arg === "--no-open") {
			openBrowser = false;
			continue;
		}
		if (arg === "--runtime-port" || arg === "--web-port") {
			const value = args[index + 1]?.trim();
			if (!value) {
				throw new Error(`${arg} requires a port.`);
			}
			if (arg === "--runtime-port") {
				requestedRuntimePort = parsePort(value, arg);
			} else {
				requestedWebUiPort = parsePort(value, arg);
			}
			index += 1;
			continue;
		}
		if (arg.startsWith("--runtime-port=") || arg.startsWith("--web-port=")) {
			const [flag, value = ""] = arg.split("=", 2);
			if (flag === "--runtime-port") {
				requestedRuntimePort = parsePort(value, flag);
			} else {
				requestedWebUiPort = parsePort(value, flag);
			}
			continue;
		}
		if (arg === "--runtime-home") {
			const value = args[index + 1]?.trim();
			if (!value) {
				throw new Error("--runtime-home requires a path.");
			}
			runtimeHome = resolveRuntimeHomeInput(value);
			index += 1;
			continue;
		}
		if (arg === "--project-path") {
			const value = args[index + 1]?.trim();
			if (!value) {
				throw new Error("--project-path requires a path.");
			}
			projectPath = resolve(value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--project-path=")) {
			const value = arg.slice("--project-path=".length).trim();
			if (!value) {
				throw new Error("--project-path requires a path.");
			}
			projectPath = resolve(value);
			continue;
		}
		if (arg.startsWith("--runtime-home=")) {
			const value = arg.slice("--runtime-home=".length).trim();
			if (!value) {
				throw new Error("--runtime-home requires a path.");
			}
			runtimeHome = resolveRuntimeHomeInput(value);
			continue;
		}
		runtimeArgs.push(arg);
	}
	if (useProductionState && runtimeHome) {
		throw new Error("--use-production-state cannot be combined with --runtime-home.");
	}
	return {
		runtimeArgs,
		runtimeHome,
		useProductionState,
		requestedRuntimePort,
		requestedWebUiPort,
		projectPath,
		openBrowser,
	};
}

const requestedDevFullArgs = process.argv.slice(2);
const withShutdownCleanupFlag = "--with-shutdown-cleanup";
const parsedDevFullArgs = parseDevFullArgs(requestedDevFullArgs);
const configuredRuntimePortStart = Number.parseInt(process.env.KANBAN_RUNTIME_PORT_START || "3484", 10);
const configuredWebUiPortStart = Number.parseInt(process.env.KANBAN_WEB_UI_PORT_START || "4173", 10);
const runtimePortStart = Number.isFinite(configuredRuntimePortStart) ? configuredRuntimePortStart : 3484;
const webUiPortStart = Number.isFinite(configuredWebUiPortStart) ? configuredWebUiPortStart : 4173;
const runtimePort = await findPort(parsedDevFullArgs.requestedRuntimePort ?? runtimePortStart);
if (parsedDevFullArgs.requestedRuntimePort && runtimePort !== parsedDevFullArgs.requestedRuntimePort) {
	throw new Error(`Runtime port ${parsedDevFullArgs.requestedRuntimePort} is already in use.`);
}
const webUiPort = await findPort(parsedDevFullArgs.requestedWebUiPort ?? webUiPortStart, new Set([runtimePort]));
if (parsedDevFullArgs.requestedWebUiPort && webUiPort !== parsedDevFullArgs.requestedWebUiPort) {
	throw new Error(`Web UI port ${parsedDevFullArgs.requestedWebUiPort} is already in use.`);
}
const requestedRuntimeArgs = parsedDevFullArgs.runtimeArgs.filter((arg) => arg !== withShutdownCleanupFlag);
const hasExplicitSkipCleanupArg = requestedRuntimeArgs.some((arg) => arg === "--skip-shutdown-cleanup");
const shouldDefaultSkipShutdownCleanup = !requestedDevFullArgs.includes(withShutdownCleanupFlag);
const configuredRuntimeHome = process.env.KANBAN_RUNTIME_HOME?.trim();
const runtimeHome = parsedDevFullArgs.useProductionState
	? null
	: (parsedDevFullArgs.runtimeHome ??
		(configuredRuntimeHome ? resolveRuntimeHomeInput(configuredRuntimeHome) : getDefaultDevRuntimeHome()));
const runtimeCwd = parsedDevFullArgs.projectPath ?? process.env.KANBAN_DEV_PROJECT_PATH?.trim() ?? repoRoot;
const runtimeCliArgs = [
	"--port",
	String(runtimePort),
	"--no-open",
	...(shouldDefaultSkipShutdownCleanup && !hasExplicitSkipCleanupArg ? ["--skip-shutdown-cleanup"] : []),
	...requestedRuntimeArgs,
];

console.log(`\n  Runtime port: ${runtimePort}`);
console.log(`  Web UI:       http://127.0.0.1:${webUiPort}`);
if (runtimeCwd !== repoRoot) {
	console.log(`  Project:      ${runtimeCwd}`);
}
console.log(`  Runtime data: ${runtimeHome ?? join(homedir(), ".kanban")}\n`);

const env = {
	...buildAgentRuntimeEnv(process.env, [join(repoRoot, "node_modules", ".bin")]),
	NODE_ENV: "development",
	KANBAN_RUNTIME_PORT: String(runtimePort),
	KANBAN_WEB_UI_PORT: String(webUiPort),
};
if (runtimeHome) {
	env.KANBAN_RUNTIME_HOME = runtimeHome;
} else {
	delete env.KANBAN_RUNTIME_HOME;
}

const tsxBin = join(repoRoot, "node_modules", ".bin", isWindows ? "tsx.cmd" : "tsx");
const runtime = spawn(tsxBin, ["watch", join(repoRoot, "src", "cli.ts"), ...runtimeCliArgs], {
	cwd: runtimeCwd,
	env,
	stdio: "inherit",
});

let vite;
let exiting = false;

function cleanup(exitCode = 0) {
	if (exiting) return;
	exiting = true;
	if (runtime.pid) treeKill(runtime.pid);
	if (vite?.pid) treeKill(vite.pid);
	process.exit(exitCode);
}

process.on("SIGTERM", () => cleanup(0));
process.on("SIGINT", () => cleanup(0));
runtime.on("exit", () => cleanup(1));

// Wait for runtime to accept connections before starting Vite
try {
	await waitForPort(runtimePort);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to start runtime: ${message}`);
	cleanup(1);
}

vite = spawn("npm", ["run", "web:dev"], {
	cwd: repoRoot,
	env,
	stdio: "inherit",
	shell: isWindows,
});

vite.on("exit", () => cleanup(1));

// Auto-open browser after a short delay for Vite to start
if (parsedDevFullArgs.openBrowser) {
	setTimeout(() => {
		open(`http://127.0.0.1:${webUiPort}`);
	}, 2000);
}
