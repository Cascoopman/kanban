import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFrontendConsoleLogger } from "@/runtime/frontend-console-logger";

describe("frontend console logger", () => {
	const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
		Promise.resolve(new Response(null, { status: 204 })),
	);
	let restoreConsole: (() => void) | null = null;

	beforeEach(() => {
		fetchMock.mockClear();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		restoreConsole?.();
		restoreConsole = null;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("preserves visible console output and forwards the same entry", () => {
		const originalWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		restoreConsole = installFrontendConsoleLogger();

		console.warn("socket closed", { code: 1006 });

		expect(originalWarn).toHaveBeenCalledWith("socket closed", { code: 1006 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, request] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe("/api/logs/frontend");
		expect(request).toMatchObject({
			method: "POST",
			credentials: "same-origin",
			keepalive: true,
		});
		expect(JSON.parse(String(request?.body))).toMatchObject({
			level: "warn",
			message: 'socket closed {"code":1006}',
		});
	});

	it("serializes errors, bigint values, and circular objects without throwing", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		restoreConsole = installFrontendConsoleLogger();
		const circular: { self?: unknown } = {};
		circular.self = circular;

		expect(() => console.error(new Error("boom"), 10n, circular)).not.toThrow();
		const [, request] = fetchMock.mock.calls[0] ?? [];
		const body = JSON.parse(String(request?.body)) as { message: string };
		expect(body.message).toContain("Error: boom");
		expect(body.message).toContain("10");
		expect(body.message).toContain('"[Circular]"');
	});

	it("does not recursively log forwarding failures", async () => {
		fetchMock.mockRejectedValueOnce(new Error("offline"));
		vi.spyOn(console, "info").mockImplementation(() => undefined);
		restoreConsole = installFrontendConsoleLogger();

		console.info("hello");
		await Promise.resolve();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
