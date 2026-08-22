import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardDetailView } from "@/components/card-detail-view";
import type { CardSelection } from "@/types";

let latestAgentConnectionReady: ((taskId: string) => void) | undefined;

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: () => {},
}));

vi.mock("@/components/detail-panels/agent-terminal-panel", () => ({
	AgentTerminalPanel: ({ onConnectionReady }: { onConnectionReady?: (taskId: string) => void }) => {
		latestAgentConnectionReady = onConnectionReady;
		return <div>Agent</div>;
	},
}));

vi.mock("@/components/detail-panels/column-context-panel", () => ({
	ColumnContextPanel: () => <div>Cards</div>,
}));

vi.mock("@/components/detail-panels/vscode-inline-panel", () => ({
	VscodeInlinePanel: ({ taskId }: { taskId: string }) => <div data-testid="vscode-panel">VS Code {taskId}</div>,
}));

vi.mock("@/hooks/use-is-mobile", () => ({
	useIsMobile: () => false,
}));

vi.mock("@/resize/use-card-detail-layout", () => ({
	useCardDetailLayout: () => ({
		taskCardsPanelRatio: 0.2,
		setTaskCardsPanelRatio: () => {},
		agentPanelRatio: 0.4,
		setAgentPanelRatio: () => {},
	}),
}));

vi.mock("@/resize/use-resize-drag", () => ({
	useResizeDrag: () => ({ startDrag: () => {} }),
}));

vi.mock("@/terminal/theme-colors", () => ({
	useTerminalThemeColors: () => ({
		surfacePrimary: "#000",
		textPrimary: "#fff",
	}),
}));

vi.mock("@/utils/react-use", () => ({
	useWindowEvent: () => {},
}));

function createSelection(taskId: string): CardSelection {
	const card = {
		id: taskId,
		title: `Task ${taskId}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
	const column = {
		id: "in_progress" as const,
		title: "In Progress",
		cards: [card],
	};
	return { card, column, allColumns: [column] };
}

describe("CardDetailView VS Code visibility", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		latestAgentConnectionReady = undefined;
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.useRealTimers();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	function render(selection: CardSelection): void {
		act(() => {
			root.render(
				<CardDetailView
					selection={selection}
					currentProjectId="project-1"
					sessionSummary={null}
					taskSessions={{}}
					onSessionSummary={() => {}}
					onCardSelect={() => {}}
					onTaskDragEnd={() => {}}
					onMoveToTrash={() => {}}
					bottomTerminalOpen={false}
					onToggleBottomTerminal={() => {}}
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});
	}

	function signalMainTerminalReady(taskId: string): void {
		act(() => {
			latestAgentConnectionReady?.(taskId);
		});
		act(() => {
			vi.runOnlyPendingTimers();
		});
	}

	it("preloads VS Code after the main terminal is ready and preserves it while collapsed", () => {
		render(createSelection("task-1"));

		expect(container.textContent).not.toContain("VS Code task-1");
		expect(container.querySelector('button[aria-label="Open VS Code"]')).toBeInstanceOf(HTMLButtonElement);

		signalMainTerminalReady("task-1");

		const preloadedPanel = container.querySelector('[data-testid="vscode-panel"]');
		expect(preloadedPanel).toBeInstanceOf(HTMLElement);
		expect(preloadedPanel?.parentElement?.getAttribute("aria-hidden")).toBe("true");

		const expandButton = container.querySelector('button[aria-label="Open VS Code"]');
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Collapsed VS Code control was not rendered.");
		}
		act(() => {
			expandButton.click();
		});
		expect(preloadedPanel?.parentElement?.hasAttribute("aria-hidden")).toBe(false);

		const collapseButton = container.querySelector('button[aria-label="Collapse VS Code"]');
		if (!(collapseButton instanceof HTMLButtonElement)) {
			throw new Error("Expanded VS Code collapse control was not rendered.");
		}

		act(() => {
			collapseButton.click();
		});
		expect(container.querySelector('[data-testid="vscode-panel"]')).toBe(preloadedPanel);
		expect(preloadedPanel?.parentElement?.getAttribute("aria-hidden")).toBe("true");
	});

	it("starts each newly selected task collapsed and schedules a fresh preload", () => {
		render(createSelection("task-1"));
		signalMainTerminalReady("task-1");
		expect(container.textContent).toContain("VS Code task-1");

		render(createSelection("task-2"));
		expect(container.textContent).not.toContain("VS Code task-1");
		expect(container.textContent).not.toContain("VS Code task-2");
		expect(container.querySelector('button[aria-label="Open VS Code"]')).toBeInstanceOf(HTMLButtonElement);

		signalMainTerminalReady("task-2");
		expect(container.textContent).toContain("VS Code task-2");
	});

	it("mounts VS Code immediately when the collapsed control is opened", () => {
		render(createSelection("task-1"));

		const expandButton = container.querySelector('button[aria-label="Open VS Code"]');
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Collapsed VS Code control was not rendered.");
		}
		act(() => {
			expandButton.click();
		});

		expect(container.textContent).toContain("VS Code task-1");
		expect(container.querySelector('[data-testid="vscode-panel"]')?.parentElement?.hasAttribute("aria-hidden")).toBe(
			false,
		);
	});

	it("eventually preloads VS Code when the terminal does not report readiness", () => {
		render(createSelection("task-1"));

		act(() => {
			vi.advanceTimersByTime(4_999);
		});
		expect(container.textContent).not.toContain("VS Code task-1");

		act(() => {
			vi.advanceTimersByTime(1);
			vi.runOnlyPendingTimers();
		});
		expect(container.textContent).toContain("VS Code task-1");
		expect(container.querySelector('[data-testid="vscode-panel"]')?.parentElement?.getAttribute("aria-hidden")).toBe(
			"true",
		);
	});
});
