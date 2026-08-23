import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { WriteStream } from "node:tty";

import { afterEach, describe, expect, it } from "vitest";

import { installBackendLogCapture } from "../../../src/logging/backend-log-capture";
import { TimestampedLogWriter } from "../../../src/logging/log-files";
import { createTempDir } from "../../utilities/temp-dir";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) {
		cleanup();
	}
});

describe("TimestampedLogWriter", () => {
	it("writes complete timestamped lines while preserving partial stream chunks", () => {
		const { path, cleanup } = createTempDir("kanban-log-writer-");
		cleanups.push(cleanup);
		const logPath = join(path, "backend.log");
		const writer = new TimestampedLogWriter(logPath);

		writer.writeChunk("stdout", "first\npart", new Date("2026-08-22T10:00:00.000Z"));
		writer.writeChunk("stdout", "ial\n", new Date("2026-08-22T10:00:01.000Z"));
		writer.writeChunk("stderr", "failure", new Date("2026-08-22T10:00:02.000Z"));
		writer.close();

		expect(readFileSync(logPath, "utf8")).toBe(
			"2026-08-22T10:00:00.000Z [stdout] first\n" +
				"2026-08-22T10:00:00.000Z [stdout] partial\n" +
				"2026-08-22T10:00:02.000Z [stderr] failure\n",
		);
	});

	it("creates private log files", () => {
		const { path, cleanup } = createTempDir("kanban-private-log-");
		cleanups.push(cleanup);
		const logPath = join(path, "frontend.log");
		const writer = new TimestampedLogWriter(logPath);
		writer.writeLine("warn", "warning");
		writer.close();

		if (process.platform !== "win32") {
			expect(statSync(logPath).mode & 0o777).toBe(0o600);
		}
	});
});

describe("installBackendLogCapture", () => {
	it("mirrors stdout and stderr without changing their visible output", () => {
		const { path, cleanup } = createTempDir("kanban-backend-capture-");
		cleanups.push(cleanup);
		const logPath = join(path, "backend.log");
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		let visibleStdout = "";
		let visibleStderr = "";
		stdout.on("data", (chunk: Buffer) => {
			visibleStdout += chunk.toString();
		});
		stderr.on("data", (chunk: Buffer) => {
			visibleStderr += chunk.toString();
		});
		const capture = installBackendLogCapture({
			stdout: stdout as unknown as WriteStream,
			stderr: stderr as unknown as WriteStream,
			path: logPath,
			now: () => new Date("2026-08-22T11:00:00.000Z"),
		});

		stdout.write("server ready\n");
		stderr.write("warning\n");
		capture.runWithoutCapture(() => stdout.write("secret\n"));
		capture.close();

		expect(visibleStdout).toBe("server ready\nsecret\n");
		expect(visibleStderr).toBe("warning\n");
		expect(readFileSync(logPath, "utf8")).toBe(
			"2026-08-22T11:00:00.000Z [stdout] server ready\n" + "2026-08-22T11:00:00.000Z [stderr] warning\n",
		);
	});
});
