import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentRuntimeEnv, stripLocalBinPathsFromPath } from "../../scripts/agent-runtime-env.mjs";

describe("agent runtime environment", () => {
	it("removes the checkout bin path while preserving an npx-installed agent", () => {
		const checkoutBin = "/repo/node_modules/.bin";
		const npxAgentBin = "/Users/example/.npm/_npx/cache/node_modules/.bin";
		const pathValue = [checkoutBin, "/usr/local/bin", npxAgentBin].join(delimiter);

		expect(stripLocalBinPathsFromPath(pathValue, [checkoutBin])).toBe(
			["/usr/local/bin", npxAgentBin].join(delimiter),
		);
	});

	it("supports the Windows-style Path environment key", () => {
		const checkoutBin = "/repo/node_modules/.bin";
		const env = buildAgentRuntimeEnv(
			{
				Path: [checkoutBin, "/tools"].join(delimiter),
				OTHER_VALUE: "preserved",
			},
			[checkoutBin],
		);

		expect(env.Path).toBe("/tools");
		expect(env.OTHER_VALUE).toBe("preserved");
	});
});
