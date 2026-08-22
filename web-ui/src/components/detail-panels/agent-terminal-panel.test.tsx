import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/terminal/use-persistent-terminal-session", () => ({
	usePersistentTerminalSession: () => ({
		containerRef: { current: null },
		lastError: null,
		isStopping: false,
		clearTerminal: vi.fn(),
		stopTerminal: vi.fn(async () => {}),
	}),
}));

describe("AgentTerminalPanel task actions", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("places the shell action beside the VS Code action", async () => {
		const onToggleShell = vi.fn();
		const onToggleCode = vi.fn();
		await act(async () => {
			root.render(
				<TooltipProvider>
					<AgentTerminalPanel
						taskId="task-1"
						workspaceId="project-1"
						summary={null}
						showSessionToolbar={false}
						onToggleShell={onToggleShell}
						onToggleCode={onToggleCode}
					/>
				</TooltipProvider>,
			);
		});

		const shellButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Open Shell",
		);
		expect(shellButton).toBeInstanceOf(HTMLButtonElement);
		act(() => shellButton?.click());
		expect(onToggleShell).toHaveBeenCalledOnce();
		const codeButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Open VS Code",
		);
		expect(codeButton).toBeInstanceOf(HTMLButtonElement);
		act(() => codeButton?.click());
		expect(onToggleCode).toHaveBeenCalledOnce();
		expect(container.textContent).not.toContain("Move Card To Done");
		expect(container.textContent).not.toContain("Commit");
		expect(container.textContent).not.toContain("Open PR");
	});

	it("uses Hide Shell and Hide VS Code labels for open panels", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<AgentTerminalPanel
						taskId="task-1"
						workspaceId="project-1"
						summary={null}
						showSessionToolbar={false}
						onToggleShell={() => {}}
						isShellOpen
						onToggleCode={() => {}}
						isCodeOpen
					/>
				</TooltipProvider>,
			);
		});

		expect(container.textContent).toContain("Hide Shell");
		expect(container.textContent).toContain("Hide VS Code");
	});
});
