import { describe, expect, it } from "vitest";

import { splitTerminalRestoreSnapshot } from "@/terminal/restore-snapshot-chunks";

describe("splitTerminalRestoreSnapshot", () => {
	it("returns no chunks for an empty snapshot", () => {
		expect(splitTerminalRestoreSnapshot("")).toEqual([]);
	});

	it("splits large snapshots without changing their contents", () => {
		const snapshot = "x".repeat(16 * 1024 + 1);
		const chunks = splitTerminalRestoreSnapshot(snapshot);

		expect(chunks).toHaveLength(2);
		expect(chunks.join("")).toBe(snapshot);
	});

	it("does not split a surrogate pair between writes", () => {
		const snapshot = `abc🚀def`;
		const chunks = splitTerminalRestoreSnapshot(snapshot, 4);

		expect(chunks).toEqual(["abc🚀", "def"]);
		expect(chunks.join("")).toBe(snapshot);
	});

	it("handles a surrogate pair when the requested chunk size is one", () => {
		expect(splitTerminalRestoreSnapshot("🚀x", 1)).toEqual(["🚀", "x"]);
	});
});
