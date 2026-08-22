import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getRuntimeHomePath, KANBAN_RUNTIME_HOME_ENV } from "../../../src/core/runtime-home";

const originalRuntimeHome = process.env[KANBAN_RUNTIME_HOME_ENV];

describe.sequential("runtime home", () => {
	afterEach(() => {
		if (originalRuntimeHome === undefined) {
			delete process.env[KANBAN_RUNTIME_HOME_ENV];
		} else {
			process.env[KANBAN_RUNTIME_HOME_ENV] = originalRuntimeHome;
		}
	});

	it("uses ~/.kanban by default", () => {
		delete process.env[KANBAN_RUNTIME_HOME_ENV];
		expect(getRuntimeHomePath()).toBe(join(homedir(), ".kanban"));
	});

	it("uses an explicit isolated runtime directory", () => {
		process.env[KANBAN_RUNTIME_HOME_ENV] = "./tmp/isolated-kanban";
		expect(getRuntimeHomePath()).toBe(resolve("./tmp/isolated-kanban"));
	});
});
