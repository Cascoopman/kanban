import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { followLogLines, formatLogLine, readLogLines } from "../../../src/commands/logs";
import { createTempDir } from "../../utilities/temp-dir";

const originalRuntimeHome = process.env.KANBAN_RUNTIME_HOME;
const cleanups: Array<() => void> = [];

afterEach(() => {
	if (originalRuntimeHome === undefined) {
		delete process.env.KANBAN_RUNTIME_HOME;
	} else {
		process.env.KANBAN_RUNTIME_HOME = originalRuntimeHome;
	}
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

function createLogFixture(): string {
	const { path, cleanup } = createTempDir("kanban-logs-command-");
	cleanups.push(cleanup);
	process.env.KANBAN_RUNTIME_HOME = path;
	const logsPath = join(path, "logs");
	mkdirSync(logsPath, { recursive: true });
	return logsPath;
}

describe("logs command helpers", () => {
	it("merges frontend and backend records chronologically and applies a combined tail", async () => {
		const logsPath = createLogFixture();
		writeFileSync(
			join(logsPath, "backend.log"),
			"2026-08-22T10:00:00.000Z [stdout] backend one\n2026-08-22T10:00:02.000Z [stderr] backend two\n",
		);
		writeFileSync(join(logsPath, "frontend.log"), "2026-08-22T10:00:01.000Z [warn] frontend one\n");

		const lines = await readLogLines(["backend", "frontend"], 2);

		expect(lines.map((line) => formatLogLine(line, true))).toEqual([
			"2026-08-22T10:00:01.000Z [frontend] [warn] frontend one",
			"2026-08-22T10:00:02.000Z [backend] [stderr] backend two",
		]);
	});

	it("returns an empty result when a source has not written a file yet", async () => {
		createLogFixture();
		expect(await readLogLines(["frontend"], null)).toEqual([]);
	});

	it("treats a zero-line tail as no initial output", async () => {
		const logsPath = createLogFixture();
		writeFileSync(join(logsPath, "backend.log"), "2026-08-22T10:00:00.000Z [stdout] existing\n");
		expect(await readLogLines(["backend"], 0)).toEqual([]);
	});

	it("follows newly appended records", async () => {
		const logsPath = createLogFixture();
		const backendPath = join(logsPath, "backend.log");
		writeFileSync(backendPath, "2026-08-22T10:00:00.000Z [stdout] existing\n");
		const controller = new AbortController();
		const received: string[] = [];
		const following = followLogLines(
			["backend"],
			(lines) => {
				received.push(...lines.map((line) => line.line));
				controller.abort();
			},
			controller.signal,
			10,
		);

		await new Promise((resolve) => setTimeout(resolve, 20));
		writeFileSync(
			backendPath,
			"2026-08-22T10:00:00.000Z [stdout] existing\n2026-08-22T10:00:01.000Z [stdout] appended\n",
		);
		await following;

		expect(received).toEqual(["2026-08-22T10:00:01.000Z [stdout] appended"]);
	});
});
