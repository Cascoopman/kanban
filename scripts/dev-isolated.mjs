#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function printHelp() {
	console.log("Usage: npm run dev:isolated -- [--agent codex|claude] [--no-open] [--keep-data]");
}

function parseArgs(argv) {
	let agent = null;
	let noOpen = false;
	let keepData = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
		if (arg === "--agent") {
			const value = argv[index + 1];
			if (value !== "codex" && value !== "claude") {
				throw new Error("--agent must be either codex or claude.");
			}
			agent = value;
			index += 1;
			continue;
		}
		if (arg === "--no-open") {
			noOpen = true;
			continue;
		}
		if (arg === "--keep-data") {
			keepData = true;
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	return { agent, noOpen, keepData };
}

function runGit(cwd, args) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed.`);
	}
}

async function createFixtureProject(previewRoot) {
	const projectPath = join(previewRoot, "sandbox-project");
	await mkdir(projectPath, { recursive: true });
	await writeFile(
		join(projectPath, "README.md"),
		"# Isolated Kanban preview\n\nThis disposable repository exists only for manual feature testing.\n",
		"utf8",
	);
	await writeFile(
		join(projectPath, "AGENTS.md"),
		"# Preview safety\n\nWork only inside this disposable repository. Do not access or modify other projects.\n",
		"utf8",
	);
	runGit(projectPath, ["init", "--initial-branch=main"]);
	runGit(projectPath, ["config", "user.name", "Kanban Preview"]);
	runGit(projectPath, ["config", "user.email", "preview@localhost"]);
	runGit(projectPath, ["add", "README.md", "AGENTS.md"]);
	runGit(projectPath, ["commit", "-m", "Initialize isolated preview project"]);
	return projectPath;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const previewRoot = await mkdtemp(join(tmpdir(), "kanban-isolated-preview-"));
	const runtimeHome = join(previewRoot, "runtime-home");
	const projectPath = await createFixtureProject(previewRoot);
	await mkdir(runtimeHome, { recursive: true });

	if (options.agent) {
		await writeFile(
			join(runtimeHome, "config.json"),
			`${JSON.stringify(
				{
					selectedAgentId: options.agent,
					agentAutonomousModeEnabled: false,
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
	}

	console.log("\n[isolated-preview] Production isolation enabled:");
	console.log(`  Runtime data: ${runtimeHome}`);
	console.log(`  Test project: ${projectPath}`);
	console.log("  Production ~/.kanban data and project repositories are not used.\n");

	const childArgs = [join(repoRoot, "scripts", "dev-full.mjs")];
	if (options.noOpen) {
		childArgs.push("--no-open");
	}
	const child = spawn(process.execPath, childArgs, {
		cwd: repoRoot,
		env: {
			...process.env,
			KANBAN_RUNTIME_HOME: runtimeHome,
			KANBAN_DEV_PROJECT_PATH: projectPath,
			KANBAN_RUNTIME_PORT_START: String(randomInt(12_000, 18_000)),
			KANBAN_WEB_UI_PORT_START: String(randomInt(20_000, 26_000)),
			VITE_KANBAN_ISOLATED_PREVIEW: "1",
		},
		stdio: "inherit",
	});

	let stopping = false;
	const stop = (signal) => {
		if (stopping) {
			return;
		}
		stopping = true;
		child.kill(signal);
	};
	process.on("SIGINT", () => stop("SIGINT"));
	process.on("SIGTERM", () => stop("SIGTERM"));

	const exitCode = await new Promise((resolveExit, reject) => {
		child.on("error", reject);
		child.on("close", (code) => resolveExit(typeof code === "number" ? code : 1));
	});

	if (options.keepData) {
		console.log(`[isolated-preview] Preserved preview data at ${previewRoot}`);
	} else {
		await rm(previewRoot, { recursive: true, force: true });
	}
	return exitCode;
}

main()
	.then((exitCode) => {
		process.exit(exitCode);
	})
	.catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[isolated-preview] ${message}`);
		process.exit(1);
	});
