import { afterEach, describe, expect, it, vi } from "vitest";

import { getTerminalThemeColors } from "@/hooks/use-theme";
import { createKanbanTerminalOptions } from "@/terminal/terminal-options";

describe("createKanbanTerminalOptions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("enables richer terminal capability reporting", () => {
		const options = createKanbanTerminalOptions({
			cursorColor: "#abcdef",
			isMacPlatform: true,
			terminalBackgroundColor: "#101112",
			themeColors: getTerminalThemeColors("default"),
		});

		expect(options.allowProposedApi).toBe(true);
		expect(options.cursorBlink).toBe(false);
		expect(options.cursorInactiveStyle).toBe("outline");
		expect(options.cursorStyle).toBe("block");
		expect(options.scrollback).toBe(10_000);
		expect(options.macOptionIsMeta).toBe(true);
		expect(options.windowOptions).toEqual({
			getCellSizePixels: true,
			getWinSizeChars: true,
			getWinSizePixels: true,
		});
		expect(options.theme?.background).toBe("#101112");
		expect(options.theme?.cursor).toBe("#abcdef");
	});

	it("opens OSC 8 HTTP links without using xterm's confirmation prompt", () => {
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
		const options = createKanbanTerminalOptions({
			cursorColor: "#abcdef",
			isMacPlatform: false,
			terminalBackgroundColor: "#101112",
			themeColors: getTerminalThemeColors("default"),
		});

		options.linkHandler?.activate(new MouseEvent("click"), "https://example.com/path?q=value", {
			start: { x: 1, y: 1 },
			end: { x: 10, y: 1 },
		});

		expect(openSpy).toHaveBeenCalledWith("https://example.com/path?q=value", "_blank", "noopener,noreferrer");
	});

	it.each(["javascript:alert(1)", "file:///tmp/example", "not a URL"])(
		"rejects unsafe or malformed OSC 8 links: %s",
		(value) => {
			const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
			const options = createKanbanTerminalOptions({
				cursorColor: "#abcdef",
				isMacPlatform: false,
				terminalBackgroundColor: "#101112",
				themeColors: getTerminalThemeColors("default"),
			});

			options.linkHandler?.activate(new MouseEvent("click"), value, {
				start: { x: 1, y: 1 },
				end: { x: 10, y: 1 },
			});

			expect(openSpy).not.toHaveBeenCalled();
		},
	);
});
