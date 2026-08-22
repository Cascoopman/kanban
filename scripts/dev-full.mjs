/**
 * Starts both the runtime server and Vite web UI dev server on an
 * automatically-selected free port. Use via `npm run dev:full` or the
 * VS Code "Dev (Full Stack)" launch config.
 */
import { createServer, connect } from "node:net";
import { access } from "node:fs/promises";
import { join } from "node:path";
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

const runtimePortStart = Number.parseInt(process.env.KANBAN_RUNTIME_PORT_START || "3484", 10);
const webUiPortStart = Number.parseInt(process.env.KANBAN_WEB_UI_PORT_START || "4173", 10);
const runtimePort = await findPort(Number.isFinite(runtimePortStart) ? runtimePortStart : 3484);
const webUiPort = await findPort(Number.isFinite(webUiPortStart) ? webUiPortStart : 4173, new Set([runtimePort]));
const requestedDevFullArgs = process.argv.slice(2);
const withShutdownCleanupFlag = "--with-shutdown-cleanup";
const noOpenFlag = "--no-open";
const requestedRuntimeArgs = requestedDevFullArgs.filter(
	(arg) => arg !== withShutdownCleanupFlag && arg !== noOpenFlag,
);
const shouldOpenBrowser = !requestedDevFullArgs.includes(noOpenFlag);
const hasExplicitSkipCleanupArg = requestedRuntimeArgs.some((arg) => arg === "--skip-shutdown-cleanup");
const shouldDefaultSkipShutdownCleanup = !requestedDevFullArgs.includes(withShutdownCleanupFlag);
const runtimeCwd = process.env.KANBAN_DEV_PROJECT_PATH?.trim() || repoRoot;
const runtimeCliArgs = [
	"--port",
	String(runtimePort),
	"--no-open",
	...(shouldDefaultSkipShutdownCleanup && !hasExplicitSkipCleanupArg ? ["--skip-shutdown-cleanup"] : []),
	...requestedRuntimeArgs,
];

console.log(`\n  Runtime port: ${runtimePort}`);
console.log(`  Web UI:       http://127.0.0.1:${webUiPort}\n`);
if (runtimeCwd !== repoRoot) {
	console.log(`  Project:      ${runtimeCwd}`);
}
if (process.env.KANBAN_RUNTIME_HOME?.trim()) {
	console.log(`  Runtime home: ${process.env.KANBAN_RUNTIME_HOME.trim()}\n`);
}

const env = {
	...buildAgentRuntimeEnv(process.env, [join(repoRoot, "node_modules", ".bin")]),
	NODE_ENV: "development",
	KANBAN_RUNTIME_PORT: String(runtimePort),
	KANBAN_WEB_UI_PORT: String(webUiPort),
};

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
setTimeout(() => {
	if (shouldOpenBrowser) {
		open(`http://127.0.0.1:${webUiPort}`);
	}
}, 2000);
