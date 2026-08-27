import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

const requireFromHere = createRequire(import.meta.url);

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

function initGitRepository(path: string): void {
	for (const args of [
		["init", "--initial-branch=main"],
		["config", "user.name", "Kanban Logging Test"],
		["config", "user.email", "logging@localhost"],
	] as const) {
		const result = spawnSync("git", args, { cwd: path, stdio: "ignore", env: createGitTestEnv() });
		if (result.status !== 0) {
			throw new Error(`git ${args.join(" ")} failed`);
		}
	}
	writeFileSync(join(path, "README.md"), "# Logging integration fixture\n", "utf8");
	for (const args of [
		["add", "README.md"],
		["-c", "commit.gpgSign=false", "commit", "-m", "Initialize fixture"],
	] as const) {
		const result = spawnSync("git", args, { cwd: path, stdio: "ignore", env: createGitTestEnv() });
		if (result.status !== 0) {
			throw new Error(`git ${args.join(" ")} failed`);
		}
	}
}

async function getAvailablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : null;
	await new Promise<void>((resolveClose, rejectClose) => {
		server.close((error) => (error ? rejectClose(error) : resolveClose()));
	});
	if (!port) {
		throw new Error("Could not allocate a test port.");
	}
	return port;
}

function spawnSourceCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
	return spawn(
		process.execPath,
		["--import", resolveTsxLoaderImportSpecifier(), resolve(process.cwd(), "src/cli.ts"), ...args],
		{
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
}

async function waitForProcessOutput(child: ChildProcess, expected: string, timeoutMs = 15_000): Promise<void> {
	await new Promise<void>((resolveOutput, rejectOutput) => {
		let output = "";
		const timeout = setTimeout(() => {
			rejectOutput(new Error(`Timed out waiting for ${JSON.stringify(expected)}. Output:\n${output}`));
		}, timeoutMs);
		const handleOutput = (chunk: Buffer) => {
			output += chunk.toString();
			if (output.includes(expected)) {
				clearTimeout(timeout);
				resolveOutput();
			}
		};
		child.stdout?.on("data", handleOutput);
		child.stderr?.on("data", handleOutput);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			rejectOutput(new Error(`Runtime exited with ${code}. Output:\n${output}`));
		});
	});
}

async function waitForFileContent(path: string, expected: string, timeoutMs = 5_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const content = existsSync(path) ? readFileSync(path, "utf8") : "";
		if (content.includes(expected)) {
			return content;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 25));
	}
	throw new Error(`Timed out waiting for ${JSON.stringify(expected)} in ${path}`);
}

async function collectProcess(
	child: ChildProcess,
	timeoutMs = 10_000,
): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
}> {
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	if (child.exitCode !== null) {
		return { stdout, stderr, exitCode: child.exitCode };
	}
	await new Promise<void>((resolveExit, rejectExit) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			rejectExit(new Error(`Process timed out. stdout:\n${stdout}\nstderr:\n${stderr}`));
		}, timeoutMs);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolveExit();
		});
	});
	return { stdout, stderr, exitCode: child.exitCode };
}

async function stopRuntime(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) {
		return;
	}
	child.kill("SIGINT");
	await collectProcess(child, 15_000);
}

function toMcpEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readMcpLogs(
	projectPath: string,
	env: NodeJS.ProcessEnv,
	args: { source: "frontend" | "backend" | "all"; tail: number },
): Promise<Record<string, unknown>> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: ["--import", resolveTsxLoaderImportSpecifier(), resolve(process.cwd(), "src/mcp.ts")],
		cwd: projectPath,
		env: toMcpEnvironment(env),
		stderr: "pipe",
	});
	const client = new Client({ name: "kanban-mcp-logging-test", version: "1.0.0" });
	await client.connect(transport);
	try {
		const result = await client.callTool({ name: "kanban_logs", arguments: args });
		if (result.isError || !isRecord(result.structuredContent)) {
			throw new Error(`kanban_logs failed: ${JSON.stringify(result)}`);
		}
		return result.structuredContent;
	} finally {
		await client.close();
	}
}

describe("persisted frontend and backend logs", () => {
	it(
		"captures runtime output, accepts frontend console entries, and exposes bounded snapshots through MCP",
		{ timeout: 40_000 },
		async () => {
			const { path: runtimeHome, cleanup: cleanupRuntimeHome } = createTempDir("kanban-logging-home-");
			const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-logging-project-");
			initGitRepository(projectPath);
			const port = await getAvailablePort();
			const env = createGitTestEnv({
				...process.env,
				HOME: runtimeHome,
				USERPROFILE: runtimeHome,
				KANBAN_RUNTIME_HOME: runtimeHome,
				KANBAN_RUNTIME_PORT: String(port),
			});
			const runtime = spawnSourceCli(["--no-open", "--port", String(port)], projectPath, env);

			try {
				await waitForProcessOutput(runtime, "Kanban running at ");
				const backendPath = join(runtimeHome, "logs", "backend.log");
				const frontendPath = join(runtimeHome, "logs", "frontend.log");
				const backendContent = await waitForFileContent(backendPath, "Kanban running at ");
				expect(backendContent).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[stdout\] Kanban running at /mu);

				const frontendResponse = await fetch(`http://127.0.0.1:${port}/api/logs/frontend`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						timestamp: "2026-08-22T20:00:00.000Z",
						level: "warn",
						message: "browser websocket disconnected",
					}),
				});
				expect(frontendResponse.status).toBe(204);
				expect(await waitForFileContent(frontendPath, "browser websocket disconnected")).toContain(
					"2026-08-22T20:00:00.000Z [warn] browser websocket disconnected",
				);

				const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/logs/frontend`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ timestamp: "invalid", level: "warn", message: "ignored" }),
				});
				expect(invalidResponse.status).toBe(400);

				const frontendLogs = await readMcpLogs(projectPath, env, { source: "frontend", tail: 10 });
				expect(JSON.stringify(frontendLogs)).toContain("browser websocket disconnected");

				const allLogs = await readMcpLogs(projectPath, env, { source: "all", tail: 10 });
				expect(JSON.stringify(allLogs)).toContain("Kanban running at");
				expect(JSON.stringify(allLogs)).toContain("browser websocket disconnected");
			} finally {
				await stopRuntime(runtime);
				cleanupProject();
				cleanupRuntimeHome();
			}
		},
	);
});
