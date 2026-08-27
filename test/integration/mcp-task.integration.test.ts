import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { delimiter, join, resolve } from "node:path";
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
	for (const args of [["init"], ["checkout", "-B", "main"]]) {
		const result = spawnSync("git", args, { cwd: path, stdio: "ignore", env: createGitTestEnv() });
		if (result.status !== 0) {
			throw new Error(`git ${args.join(" ")} failed for ${path}`);
		}
	}
}

function commitAll(cwd: string): void {
	for (const args of [
		["add", "."],
		["commit", "-qm", "initial commit"],
	]) {
		const result = spawnSync("git", args, { cwd, stdio: "ignore", env: createGitTestEnv() });
		if (result.status !== 0) {
			throw new Error(`git ${args.join(" ")} failed for ${cwd}`);
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
	await new Promise<void>((resolveClose, rejectClose) =>
		server.close((error) => (error ? rejectClose(error) : resolveClose())),
	);
	if (!port) {
		throw new Error("Could not allocate a port.");
	}
	return port;
}

async function waitForRuntime(process: ChildProcess, timeoutMs = 10_000): Promise<void> {
	await new Promise<void>((resolveStart, rejectStart) => {
		let output = "";
		const timeout = setTimeout(
			() => rejectStart(new Error(`Timed out starting Kanban runtime:\n${output}`)),
			timeoutMs,
		);
		const onData = (chunk: Buffer) => {
			output += chunk.toString();
			if (output.includes("Kanban running at ")) {
				clearTimeout(timeout);
				resolveStart();
			}
		};
		process.stdout?.on("data", onData);
		process.stderr?.on("data", onData);
		process.once("exit", (code) => {
			clearTimeout(timeout);
			rejectStart(new Error(`Kanban runtime exited before startup (${String(code)}):\n${output}`));
		});
	});
}

async function stopRuntime(process: ChildProcess): Promise<void> {
	if (process.exitCode !== null) {
		return;
	}
	process.kill("SIGINT");
	await new Promise<void>((resolveStop) => {
		const timeout = setTimeout(() => {
			process.kill("SIGKILL");
			resolveStop();
		}, 5_000);
		process.once("exit", () => {
			clearTimeout(timeout);
			resolveStop();
		});
	});
}

function toMcpEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
	return Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	);
}

async function withMcp<T>(
	projectPath: string,
	env: NodeJS.ProcessEnv,
	callback: (client: Client) => Promise<T>,
): Promise<T> {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: ["--import", resolveTsxLoaderImportSpecifier(), resolve(process.cwd(), "src/mcp.ts")],
		cwd: projectPath,
		env: toMcpEnvironment(env),
		stderr: "pipe",
	});
	const client = new Client({ name: "kanban-mcp-integration-test", version: "1.0.0" });
	await client.connect(transport);
	try {
		return await callback(client);
	} finally {
		await client.close();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
	const result = await client.callTool({ name, arguments: args });
	if (result.isError) {
		throw new Error(JSON.stringify(result));
	}
	if (!isRecord(result.structuredContent)) {
		throw new Error(`${name} did not return structured content.`);
	}
	return result.structuredContent;
}

describe("Kanban MCP task lifecycle", () => {
	it(
		"uses real stdio MCP transport to create, resolve, update, trash, and delete a task",
		{ timeout: 90_000 },
		async () => {
			const { path: homeDir, cleanup: cleanupHome } = createTempDir("kanban-mcp-home-");
			const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-mcp-project-");

			try {
				initGitRepository(projectPath);
				writeFileSync(join(projectPath, "README.md"), "# Kanban MCP integration\n", "utf8");
				commitAll(projectPath);

				const port = String(await getAvailablePort());
				const agentBinDir = join(homeDir, "agent-bin");
				mkdirSync(agentBinDir, { recursive: true });
				const agentPath = join(agentBinDir, "codex");
				writeFileSync(agentPath, "#!/bin/sh\nwhile :; do sleep 1; done\n", "utf8");
				chmodSync(agentPath, 0o755);
				const env = createGitTestEnv({
					HOME: homeDir,
					USERPROFILE: homeDir,
					KANBAN_RUNTIME_HOME: join(homeDir, ".kanban"),
					KANBAN_RUNTIME_PORT: port,
					PATH: `${agentBinDir}${delimiter}${process.env.PATH ?? ""}`,
				});

				const runtime = spawn(
					process.execPath,
					["--import", resolveTsxLoaderImportSpecifier(), resolve(process.cwd(), "src/cli.ts"), "--no-open"],
					{ cwd: projectPath, env, stdio: ["ignore", "pipe", "pipe"] },
				);

				try {
					await waitForRuntime(runtime);
					const created = await withMcp(
						projectPath,
						env,
						async (client) =>
							await callTool(client, "kanban_task_create", {
								title: "Exercise the MCP lifecycle",
								project_path: projectPath,
								agent_id: "codex",
							}),
					);
					const task = created.task as { id?: string } | undefined;
					const taskId = task?.id;
					if (!taskId) {
						throw new Error(`Create response omitted task id: ${JSON.stringify(created)}`);
					}

					const workspaceIndex = JSON.parse(
						readFileSync(join(homeDir, ".kanban", "workspaces", "index.json"), "utf8"),
					) as { entries?: Record<string, { workspaceId?: string }> };
					const workspaceId = Object.values(workspaceIndex.entries ?? {})[0]?.workspaceId;
					expect(workspaceId).toBeTruthy();

					const taskEnv = createGitTestEnv({
						...env,
						KANBAN_TASK_ID: taskId,
						KANBAN_WORKSPACE_ID: workspaceId,
					});
					await withMcp(projectPath, taskEnv, async (client) => {
						const current = await callTool(client, "kanban_task_current", {});
						expect((current.task as { id?: string } | undefined)?.id).toBe(taskId);

						const updated = await callTool(client, "kanban_task_update", { title: "MCP lifecycle updated" });
						expect((updated.task as { title?: string } | undefined)?.title).toBe("MCP lifecycle updated");
					});

					await withMcp(projectPath, env, async (client) => {
						const listed = await callTool(client, "kanban_task_list", {
							project_path: projectPath,
							column: "in_progress",
						});
						expect(listed.count).toBe(1);

						const trashed = await callTool(client, "kanban_task_trash", {
							task_id: taskId,
							project_path: projectPath,
						});
						expect(trashed.worktreeDeleted).toBe(true);

						const deleted = await callTool(client, "kanban_task_delete", {
							task_id: taskId,
							project_path: projectPath,
						});
						expect(deleted.count).toBe(1);

						const afterDelete = await callTool(client, "kanban_task_list", {
							project_path: projectPath,
							column: "done",
						});
						expect(afterDelete.count).toBe(0);
					});
				} finally {
					await stopRuntime(runtime);
				}
			} finally {
				cleanupProject();
				cleanupHome();
			}
		},
	);
});
