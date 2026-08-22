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

	it("places the shell action beside the done action without fixed git actions", async () => {
		const onToggleShell = vi.fn();
		await act(async () => {
			root.render(
				<TooltipProvider>
					<AgentTerminalPanel
						taskId="task-1"
						workspaceId="project-1"
						summary={null}
						showSessionToolbar={false}
						showMoveToTrash
						onMoveToTrash={() => {}}
						onToggleShell={onToggleShell}
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
		expect(container.textContent).toContain("Move Card To Done");
		expect(container.textContent).not.toContain("Commit");
		expect(container.textContent).not.toContain("Open PR");
	});
});
