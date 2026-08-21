import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockTerminalInstance {
	autoCompleteWrites: boolean;
	cols: number;
	dispose: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
	pendingWriteCallbacks: Array<() => void>;
	reset: ReturnType<typeof vi.fn>;
	rows: number;
	scrollToBottom: ReturnType<typeof vi.fn>;
}

interface MockFitAddonInstance {
	fit: ReturnType<typeof vi.fn>;
}

const terminalMockState = vi.hoisted(() => ({
	fitAddons: [] as MockFitAddonInstance[],
	terminals: [] as MockTerminalInstance[],
}));

vi.mock("@xterm/xterm", () => ({
	Terminal: class {
		readonly dispose = vi.fn();
		readonly focus = vi.fn();
		readonly pendingWriteCallbacks: Array<() => void> = [];
		readonly reset = vi.fn();
		readonly scrollToBottom = vi.fn();
		readonly unicode = { activeVersion: "" };
		readonly options: { theme?: Record<string, string> } = {};
		autoCompleteWrites = true;
		cols: number;
		rows: number;

		constructor(options: { cols?: number; rows?: number }) {
			this.cols = options.cols ?? 80;
			this.rows = options.rows ?? 24;
			terminalMockState.terminals.push(this);
		}

		loadAddon(): void {}

		open(): void {}

		onData(): void {}

		onBinary(): void {}

		attachCustomKeyEventHandler(): void {}

		hasSelection(): boolean {
			return false;
		}

		getSelection(): string {
			return "";
		}

		write(_data: string | Uint8Array, callback?: () => void): void {
			if (!callback) {
				return;
			}
			if (this.autoCompleteWrites) {
				callback();
				return;
			}
			this.pendingWriteCallbacks.push(callback);
		}

		resize(cols: number, rows: number): void {
			this.cols = cols;
			this.rows = rows;
		}

		input(): void {}

		paste(): void {}

		clear(): void {}
	},
}));

vi.mock("@xterm/addon-fit", () => ({
	FitAddon: class {
		readonly fit = vi.fn();

		constructor() {
			terminalMockState.fitAddons.push(this);
		}
	},
}));

vi.mock("@xterm/addon-clipboard", () => ({ ClipboardAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
	WebglAddon: class {
		onContextLoss(): void {}

		dispose(): void {}
	},
}));

vi.mock("@/hooks/use-theme", () => ({
	getTerminalThemeColors: () => ({
		selectionBackground: "selection",
		selectionForeground: "selection-foreground",
		selectionInactiveBackground: "selection-inactive",
		textPrimary: "text",
	}),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			stopTaskSession: {
				mutate: vi.fn(),
			},
		},
	}),
}));

vi.mock("@/utils/platform", () => ({ isMacPlatform: false }));

import {
	disposeAllPersistentTerminalsForWorkspace,
	ensurePersistentTerminal,
} from "@/terminal/persistent-terminal-manager";

interface SentControlMessage {
	type: string;
}

class MockWebSocket {
	static readonly OPEN = 1;
	static readonly instances: MockWebSocket[] = [];

	readonly sent: string[] = [];
	readonly url: string;
	readyState = MockWebSocket.OPEN;
	binaryType = "";
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onmessage: ((event: MessageEvent<string>) => void) | null = null;
	onopen: (() => void) | null = null;

	constructor(url: string | URL) {
		this.url = String(url);
		MockWebSocket.instances.push(this);
	}

	addEventListener(): void {}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
		if (typeof data === "string") {
			this.sent.push(data);
		}
	}

	close(): void {
		this.readyState = 3;
	}

	emitControlMessage(message: object): void {
		this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
	}
}

type ResizeObserverCallback = ConstructorParameters<typeof ResizeObserver>[0];

class MockResizeObserver implements ResizeObserver {
	static readonly instances: MockResizeObserver[] = [];
	readonly callback: ResizeObserverCallback;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		MockResizeObserver.instances.push(this);
	}

	disconnect(): void {}

	observe(): void {}

	unobserve(): void {}

	trigger(): void {
		this.callback([], this);
	}
}

function requireLatest<T>(items: T[], label: string): T {
	const item = items.at(-1);
	if (!item) {
		throw new Error(`Expected ${label}.`);
	}
	return item;
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("PersistentTerminal viewport lifecycle", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		terminalMockState.fitAddons.length = 0;
		terminalMockState.terminals.length = 0;
		MockWebSocket.instances.length = 0;
		MockResizeObserver.instances.length = 0;
		Object.defineProperty(globalThis, "WebSocket", {
			configurable: true,
			value: MockWebSocket,
			writable: true,
		});
		Object.defineProperty(globalThis, "ResizeObserver", {
			configurable: true,
			value: MockResizeObserver,
			writable: true,
		});
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
	});

	afterEach(() => {
		disposeAllPersistentTerminalsForWorkspace("workspace-1");
		document.getElementById("kb-persistent-terminal-parking-root")?.remove();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("anchors reopened terminals at the bottom without overriding ordinary resize scrolling", async () => {
		const persistentTerminal = ensurePersistentTerminal({
			taskId: "task-1",
			workspaceId: "workspace-1",
			cursorColor: "cursor",
			terminalBackgroundColor: "background",
		});
		const terminal = requireLatest(terminalMockState.terminals, "terminal instance");
		const fitAddon = requireLatest(terminalMockState.fitAddons, "fit addon");
		const controlSocket = requireLatest(
			MockWebSocket.instances.filter((socket) => socket.url.includes("/control")),
			"control socket",
		);
		const container = document.createElement("div");
		container.getBoundingClientRect = () =>
			({ width: 1_200, height: 800 }) as ReturnType<HTMLElement["getBoundingClientRect"]>;
		document.body.appendChild(container);

		persistentTerminal.mount(
			container,
			{
				cursorColor: "cursor",
				terminalBackgroundColor: "background",
			},
			{ autoFocus: true, isVisible: true },
		);

		// The initial mount requests bottom anchoring, but fitting must wait until
		// the serialized terminal state has finished replaying.
		expect(fitAddon.fit).not.toHaveBeenCalled();
		expect(terminal.scrollToBottom).not.toHaveBeenCalled();

		terminal.autoCompleteWrites = false;
		controlSocket.emitControlMessage({
			type: "restore",
			snapshot: "restored output",
			cols: 120,
			rows: 40,
		});
		await flushPromises();

		const resizeObserver = requireLatest(MockResizeObserver.instances, "resize observer");
		resizeObserver.trigger();
		vi.advanceTimersByTime(50);
		expect(fitAddon.fit).not.toHaveBeenCalled();

		const finishRestoreWrite = requireLatest(terminal.pendingWriteCallbacks, "pending terminal write");
		finishRestoreWrite();
		await flushPromises();

		expect(fitAddon.fit).toHaveBeenCalledTimes(1);
		expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
		expect(controlSocket.sent.map((message) => (JSON.parse(message) as SentControlMessage).type)).toEqual([
			"resize",
			"restore_complete",
		]);

		// Layout changes while the ticket remains open should preserve a user's
		// deliberate scroll position.
		resizeObserver.trigger();
		vi.advanceTimersByTime(50);
		expect(fitAddon.fit).toHaveBeenCalledTimes(2);
		expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);

		persistentTerminal.unmount(container);
		persistentTerminal.mount(
			container,
			{
				cursorColor: "cursor",
				terminalBackgroundColor: "background",
			},
			{ autoFocus: true, isVisible: true },
		);

		expect(fitAddon.fit).toHaveBeenCalledTimes(3);
		expect(terminal.scrollToBottom).toHaveBeenCalledTimes(2);
		container.remove();
	});
});
