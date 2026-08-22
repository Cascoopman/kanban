import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { isTcpPortReachable, parseFixedRuntimePort } from "../../scripts/dogfood-port-guard.mjs";

const servers = [];

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise((resolve, reject) => {
					server.close((error) => {
						if (error) {
							reject(error);
							return;
						}
						resolve();
					});
				}),
	),
	);
});

describe("dogfood runtime port guard", () => {
	it("recognizes fixed runtime ports", () => {
		expect(parseFixedRuntimePort("3484")).toBe(3484);
		expect(parseFixedRuntimePort("auto")).toBeNull();
		expect(parseFixedRuntimePort("0")).toBeNull();
		expect(parseFixedRuntimePort("65536")).toBeNull();
	});

	it("detects a runtime port that is already accepting connections", async () => {
		const server = createServer();
		servers.push(server);
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected a TCP server address.");
		}

		await expect(isTcpPortReachable(address.port)).resolves.toBe(true);
	});
});
