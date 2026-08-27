import { describe, expect, it } from "vitest";

import {
	buildKanbanCodexHookCommandParts,
	buildKanbanHooksCommandParts,
	resolveKanbanCommandParts,
} from "../../src/core/kanban-command";

describe("resolveKanbanCommandParts", () => {
	it("resolves node plus script entrypoint", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/tmp/.npx/123/node_modules/kanban/dist/cli.js", "--port", "9123"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "/tmp/.npx/123/node_modules/kanban/dist/cli.js"]);
	});

	it("resolves tsx launched cli entrypoint", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "/repo/src/cli.ts", "--no-open"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "/repo/src/cli.ts"]);
	});

	it("preserves node execArgv for source entrypoints", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			execArgv: ["--import", "tsx"],
			argv: ["/usr/local/bin/node", "/repo/src/cli.ts", "--no-open"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "--import", "tsx", "/repo/src/cli.ts"]);
	});

	it("falls back to execPath when no entrypoint path is available", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/kanban",
			argv: ["/usr/local/bin/kanban", "hooks", "ingest"],
		});
		expect(parts).toEqual(["/usr/local/bin/kanban"]);
	});
});

describe("buildKanbanHooksCommandParts", () => {
	it("uses the bundled hooks entrypoint beside the runtime launcher", () => {
		expect(
			buildKanbanHooksCommandParts(["ingest"], {
				execPath: "/usr/local/bin/node",
				argv: ["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanban/dist/cli.js"],
			}),
		).toEqual(["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanban/dist/hooks.js", "ingest"]);
	});

	it("falls back to the installed hook executable for opaque launches", () => {
		expect(
			buildKanbanHooksCommandParts(["notify"], {
				execPath: "/usr/local/bin/kanban",
				argv: ["/usr/local/bin/kanban"],
			}),
		).toEqual(["kanban-hooks", "notify"]);
	});
});

describe("buildKanbanCodexHookCommandParts", () => {
	it("uses the lightweight bundled hook beside the packaged CLI", () => {
		expect(
			buildKanbanCodexHookCommandParts(["--event", "activity"], {
				execPath: "/usr/local/bin/node",
				argv: ["/usr/local/bin/node", "/tmp/node_modules/kanban/dist/cli.js"],
			}),
		).toEqual(["/usr/local/bin/node", "/tmp/node_modules/kanban/dist/codex-hook.js", "--event", "activity"]);
	});

	it("uses the lightweight source hook while running through tsx", () => {
		expect(
			buildKanbanCodexHookCommandParts(["--event", "activity"], {
				execPath: "/usr/local/bin/node",
				execArgv: ["--import", "tsx"],
				argv: ["/usr/local/bin/node", "/repo/src/cli.ts"],
			}),
		).toEqual(["/usr/local/bin/node", "--import", "tsx", "/repo/src/codex-hook-cli.ts", "--event", "activity"]);
	});

	it("falls back to the installed hook executable for opaque launches", () => {
		expect(
			buildKanbanCodexHookCommandParts(["--event", "activity"], {
				execPath: "/usr/local/bin/kanban",
				argv: ["/usr/local/bin/kanban"],
			}),
		).toEqual(["kanban-hooks", "codex-hook", "--event", "activity"]);
	});
});
