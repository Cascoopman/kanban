import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const requireFromHere = createRequire(import.meta.url);

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

describe("runtime launcher CLI", () => {
	it("does not expose the removed agent-facing task CLI", () => {
		const result = spawnSync(
			process.execPath,
			["--import", resolveTsxLoaderImportSpecifier(), resolve(process.cwd(), "src/cli.ts"), "task"],
			{
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("too many arguments");
	});
});
