import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardDetailView } from "@/components/card-detail-view";
import type { CardSelection } from "@/types";

const useRuntimeWorkspaceChangesMock = vi.hoisted(() =>
	vi.fn((taskId: string | null) => {
		void taskId;
		return {
			changes: null,
			isLoading: false,
			isRuntimeAvailable: true,
			refresh: async () => {},
		};
	}),
);

vi.mock("react-hotkeys-hook", () => ({
	useHotkeys: () => {},
}));

vi.mock("@/components/detail-panels/agent-terminal-panel", () => ({
	AgentTerminalPanel: () => <div>Agent</div>,
}));

vi.mock("@/components/detail-panels/column-context-panel", () => ({
	ColumnContextPanel: () => <div>Cards</div>,
}));

vi.mock("@/components/detail-panels/diff-viewer-panel", () => ({
	DiffViewerPanel: () => <div>Diff</div>,
}));

vi.mock("@/components/detail-panels/file-tree-panel", () => ({
	FileTreePanel: () => <div>Files</div>,
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
		detailDiffFileTreeRatio: 0.33,
		setDetailDiffFileTreeRatio: () => {},
	}),
}));

vi.mock("@/resize/use-resize-drag", () => ({
	useResizeDrag: () => ({ startDrag: () => {} }),
}));

vi.mock("@/runtime/use-runtime-workspace-changes", () => ({
	useRuntimeWorkspaceChanges: useRuntimeWorkspaceChangesMock,
}));

vi.mock("@/stores/workspace-metadata-store", () => ({
	useTaskWorkspaceStateVersionValue: () => 0,
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
		prompt: "Test prompt",
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

describe("CardDetailView diff visibility", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		useRuntimeWorkspaceChangesMock.mockClear();
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
					bottomTerminalTaskId={null}
					bottomTerminalSummary={null}
					onBottomTerminalClose={() => {}}
				/>,
			);
		});
	}

	it("keeps diff calculation disabled until opened and disables it again when collapsed", () => {
		render(createSelection("task-1"));

		expect(useRuntimeWorkspaceChangesMock.mock.lastCall?.[0]).toBeNull();
		const expandButton = container.querySelector('button[aria-label="Expand diff viewer (All Changes)"]');
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Collapsed diff control was not rendered.");
		}

		act(() => {
			expandButton.click();
		});
		expect(useRuntimeWorkspaceChangesMock.mock.lastCall?.[0]).toBe("task-1");

		const collapseButton = container.querySelector('button[aria-label="Collapse diff viewer"]');
		if (!(collapseButton instanceof HTMLButtonElement)) {
			throw new Error("Expanded diff collapse control was not rendered.");
		}

		act(() => {
			collapseButton.click();
		});
		expect(useRuntimeWorkspaceChangesMock.mock.lastCall?.[0]).toBeNull();
	});

	it("starts each newly selected task with its diff calculation disabled", () => {
		render(createSelection("task-1"));
		const expandButton = container.querySelector('button[aria-label="Expand diff viewer (All Changes)"]');
		if (!(expandButton instanceof HTMLButtonElement)) {
			throw new Error("Collapsed diff control was not rendered.");
		}
		act(() => {
			expandButton.click();
		});
		expect(useRuntimeWorkspaceChangesMock.mock.lastCall?.[0]).toBe("task-1");

		render(createSelection("task-2"));
		expect(useRuntimeWorkspaceChangesMock.mock.lastCall?.[0]).toBeNull();
	});
});
