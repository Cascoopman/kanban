import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDir, "..");
const runtimePort = 34_984;
const webUiPort = 41_973;
const e2eRoot = mkdtempSync(join(tmpdir(), "kanban-e2e-"));
const e2eRuntimeHome = join(e2eRoot, "runtime-home");
const e2eProjectPath = join(e2eRoot, "project");

mkdirSync(e2eRuntimeHome, { recursive: true });
mkdirSync(e2eProjectPath, { recursive: true });
writeFileSync(join(e2eProjectPath, "README.md"), "# Kanban Playwright fixture\n", "utf8");
for (const args of [
	["init", "--initial-branch=main"],
	["config", "user.name", "Kanban Playwright"],
	["config", "user.email", "playwright@localhost"],
	["add", "README.md"],
	["-c", "commit.gpgSign=false", "commit", "-m", "Initialize Playwright fixture"],
] as const) {
	const result = spawnSync("git", args, { cwd: e2eProjectPath, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	}
}

process.once("exit", () => {
	rmSync(e2eRoot, { recursive: true, force: true });
});

export default defineConfig({
	testDir: "./tests",
	timeout: 30_000,
	metadata: {
		runtimeHome: e2eRuntimeHome,
	},
	use: {
		baseURL: `http://127.0.0.1:${webUiPort}`,
		headless: true,
	},
	webServer: {
		command: `npm run dev:full -- --no-open --runtime-home ${JSON.stringify(e2eRuntimeHome)} --project-path ${JSON.stringify(e2eProjectPath)} --runtime-port ${runtimePort} --web-port ${webUiPort}`,
		cwd: repositoryRoot,
		url: `http://127.0.0.1:${webUiPort}`,
		reuseExistingServer: false,
	},
});
