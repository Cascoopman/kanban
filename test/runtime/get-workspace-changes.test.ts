import { execFile } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getWorkspaceChanges, getWorkspaceChangesBetweenRefs } from "../../src/workspace/get-workspace-changes";

const execFileAsync = promisify(execFile);
const SIX_MIB = 6 * 1024 * 1024;

async function runGit(repoRoot: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=false", ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
		},
	});
	return stdout.trim();
}

async function commitAll(repoRoot: string, message: string): Promise<string> {
	await runGit(repoRoot, ["add", "."]);
	await runGit(repoRoot, ["commit", "-m", message]);
	return await runGit(repoRoot, ["rev-parse", "HEAD"]);
}

async function createSparseFile(path: string, size: number): Promise<void> {
	const handle = await open(path, "w");
	try {
		await handle.truncate(size);
	} finally {
		await handle.close();
	}
}

describe("getWorkspaceChanges", () => {
	let repoRoot: string;

	beforeEach(async () => {
		repoRoot = await mkdtemp(join(tmpdir(), "kanban-workspace-changes-"));
		await runGit(repoRoot, ["init"]);
		await runGit(repoRoot, ["config", "user.email", "test@example.com"]);
		await runGit(repoRoot, ["config", "user.name", "Test User"]);
	});

	afterEach(async () => {
		await rm(repoRoot, { recursive: true, force: true });
	});

	it("skips tracked binary contents", async () => {
		const filePath = join(repoRoot, "large.bin");
		await writeFile(filePath, "initial\n");
		await commitAll(repoRoot, "Initial commit");
		await createSparseFile(filePath, SIX_MIB);

		const response = await getWorkspaceChanges(repoRoot);
		const file = response.files.find((entry) => entry.path === "large.bin");

		expect(file?.status).toBe("modified");
		expect(file?.oldText).toBeNull();
		expect(file?.newText).toBeNull();
	});

	it("skips untracked binary contents", async () => {
		await writeFile(join(repoRoot, "README.md"), "initial\n");
		await commitAll(repoRoot, "Initial commit");
		await createSparseFile(join(repoRoot, "untracked.dat"), SIX_MIB);

		const response = await getWorkspaceChanges(repoRoot);
		const file = response.files.find((entry) => entry.path === "untracked.dat");

		expect(file?.status).toBe("untracked");
		expect(file?.oldText).toBeNull();
		expect(file?.newText).toBeNull();
	});

	it("preflights oversized text before loading working-tree or historical content", async () => {
		const filePath = join(repoRoot, "large.txt");
		await writeFile(filePath, "initial\n");
		const smallRef = await commitAll(repoRoot, "Initial commit");
		await writeFile(filePath, "x".repeat(SIX_MIB));

		const workingResponse = await getWorkspaceChanges(repoRoot);
		const workingFile = workingResponse.files.find((entry) => entry.path === "large.txt");
		expect(workingFile?.oldText).toBeNull();
		expect(workingFile?.newText).toBeNull();

		const largeRef = await commitAll(repoRoot, "Large text commit");
		const historicalResponse = await getWorkspaceChangesBetweenRefs({
			cwd: repoRoot,
			fromRef: smallRef,
			toRef: largeRef,
		});
		const historicalFile = historicalResponse.files.find((entry) => entry.path === "large.txt");
		expect(historicalFile?.oldText).toBeNull();
		expect(historicalFile?.newText).toBeNull();
	});
});
