import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FrontendLogStore, parseFrontendLogEntry } from "../../../src/logging/frontend-log-store";
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

describe("frontend log storage", () => {
	it("accepts supported console payloads and rejects malformed entries", () => {
		expect(
			parseFrontendLogEntry({
				timestamp: "2026-08-22T12:00:00.000Z",
				level: "warn",
				message: "frontend warning",
			}),
		).toEqual({
			timestamp: new Date("2026-08-22T12:00:00.000Z"),
			level: "warn",
			message: "frontend warning",
		});
		expect(parseFrontendLogEntry({ timestamp: "invalid", level: "warn", message: "bad" })).toBeNull();
		expect(
			parseFrontendLogEntry({ timestamp: "2026-08-22T12:00:00.000Z", level: "trace", message: "bad" }),
		).toBeNull();
		expect(parseFrontendLogEntry(null)).toBeNull();
	});

	it("writes frontend entries beneath the selected runtime home", () => {
		const { path, cleanup } = createTempDir("kanban-frontend-store-");
		cleanups.push(cleanup);
		process.env.KANBAN_RUNTIME_HOME = path;
		const store = new FrontendLogStore();
		store.append({
			timestamp: new Date("2026-08-22T12:30:00.000Z"),
			level: "error",
			message: "first line\nsecond line",
		});
		store.close();

		expect(readFileSync(join(path, "logs", "frontend.log"), "utf8")).toBe(
			"2026-08-22T12:30:00.000Z [error] first line\n" + "2026-08-22T12:30:00.000Z [error] second line\n",
		);
	});
});
