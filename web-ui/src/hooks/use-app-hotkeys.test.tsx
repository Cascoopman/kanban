import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useHotkeys } from "react-hotkeys-hook";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppHotkeys } from "@/hooks/use-app-hotkeys";

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: vi.fn(),
}));

const mockUseHotkeys = vi.mocked(useHotkeys);

function HookHarness(props: Parameters<typeof useAppHotkeys>[0]): null {
	useAppHotkeys(props);
	return null;
}

function createProps(overrides: Partial<Parameters<typeof useAppHotkeys>[0]> = {}) {
	return {
		selectedCard: null,
		isDetailTerminalOpen: false,
		isHomeTerminalOpen: false,
		isHomeGitHistoryOpen: false,
		canUseCreateTaskShortcut: true,
		handleToggleDetailTerminal: vi.fn(),
		handleToggleHomeTerminal: vi.fn(),
		handleToggleExpandDetailTerminal: vi.fn(),
		handleToggleExpandHomeTerminal: vi.fn(),
		handleOpenCreateTask: vi.fn(),
		handleOpenSettings: vi.fn(),
		handleToggleGitHistory: vi.fn(),
		handleCloseGitHistory: vi.fn(),
		...overrides,
	};
}

describe("useAppHotkeys", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockUseHotkeys.mockReset();
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("registers git history and settings shortcuts", async () => {
		const props = createProps();
		await act(async () => root.render(<HookHarness {...props} />));

		const gitHistoryCall = mockUseHotkeys.mock.calls.find(([shortcut]) => shortcut === "mod+g");
		const settingsCall = mockUseHotkeys.mock.calls.find(([shortcut]) => shortcut === "mod+shift+s");
		if (!gitHistoryCall || typeof gitHistoryCall[1] !== "function") {
			throw new Error("Expected git history shortcut to be registered.");
		}
		if (!settingsCall || typeof settingsCall[1] !== "function") {
			throw new Error("Expected settings shortcut to be registered.");
		}

		act(() => {
			(gitHistoryCall[1] as () => void)();
			(settingsCall[1] as () => void)();
		});

		expect(props.handleToggleGitHistory).toHaveBeenCalledOnce();
		expect(props.handleOpenSettings).toHaveBeenCalledOnce();
	});

	it("closes home git history on Escape", async () => {
		const props = createProps({ isHomeGitHistoryOpen: true });
		await act(async () => root.render(<HookHarness {...props} />));

		const escapeCall = mockUseHotkeys.mock.calls.find(([shortcut]) => shortcut === "escape");
		if (!escapeCall || typeof escapeCall[1] !== "function") {
			throw new Error("Expected Escape shortcut to be registered.");
		}

		act(() => {
			(escapeCall[1] as (event: KeyboardEvent) => void)(
				new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
			);
		});

		expect(props.handleCloseGitHistory).toHaveBeenCalledOnce();
	});

	it("does not open create task when the shortcut is disabled", async () => {
		const props = createProps({ canUseCreateTaskShortcut: false });
		await act(async () => root.render(<HookHarness {...props} />));

		const createTaskCall = mockUseHotkeys.mock.calls.find(([shortcut]) => shortcut === "c");
		if (!createTaskCall || typeof createTaskCall[1] !== "function") {
			throw new Error("Expected create task shortcut to be registered.");
		}

		act(() => {
			(createTaskCall[1] as () => void)();
		});

		expect(props.handleOpenCreateTask).not.toHaveBeenCalled();
	});
});
