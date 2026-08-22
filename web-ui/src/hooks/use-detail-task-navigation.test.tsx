import type { Dispatch, SetStateAction } from "react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDetailTaskNavigation } from "@/hooks/use-detail-task-navigation";
import type { BoardData } from "@/types";

function createBoard(): BoardData {
	return {
		columns: [
			{
				id: "in_progress",
				title: "In Progress",
				cards: [
					{
						id: "task-1",
						title: "Task 1",
						startInPlanMode: false,
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
	};
}

interface HookSnapshot {
	selectedTaskId: string | null;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	handleProjectTaskSelect: (projectId: string, taskId: string) => void;
}

function HookHarness({
	board,
	currentProjectId,
	isTaskCatalogReady = true,
	onSelectProject = () => {},
	onDetailClosed,
	onSnapshot,
}: {
	board: BoardData;
	currentProjectId: string | null;
	isTaskCatalogReady?: boolean;
	onSelectProject?: (projectId: string) => void;
	onDetailClosed?: () => void;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const navigation = useDetailTaskNavigation({
		board,
		currentProjectId,
		isTaskCatalogReady,
		onSelectProject,
		onDetailClosed,
	});

	useEffect(() => {
		onSnapshot({
			selectedTaskId: navigation.selectedTaskId,
			setSelectedTaskId: navigation.setSelectedTaskId,
			handleProjectTaskSelect: navigation.handleProjectTaskSelect,
		});
	}, [
		navigation.handleProjectTaskSelect,
		navigation.selectedTaskId,
		navigation.setSelectedTaskId,
		onSnapshot,
	]);

	return null;
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected hook snapshot to be available.");
	}
	return snapshot;
}

describe("useDetailTaskNavigation", () => {
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
		window.history.replaceState({}, "", "/project-1");
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		window.history.replaceState({}, "", "/");
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("keeps the selected task open across same-project rerenders", () => {
		const board = createBoard();
		let latestSnapshot: HookSnapshot | null = null;

		const renderHarness = (onDetailClosed?: () => void) => {
			act(() => {
				root.render(
					<HookHarness
						board={board}
						currentProjectId="project-1"
						onDetailClosed={onDetailClosed}
						onSnapshot={(snapshot) => {
							latestSnapshot = snapshot;
						}}
					/>,
				);
			});
		};

		renderHarness(() => {});

		act(() => {
			requireSnapshot(latestSnapshot).setSelectedTaskId("task-1");
		});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBe("task-1");

		renderHarness(() => {});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBe("task-1");
	});

	it("keeps the selected task open while its project becomes active in the background", () => {
		const board = createBoard();
		let latestSnapshot: HookSnapshot | null = null;
		const onDetailClosed = vi.fn();

		act(() => {
			root.render(
				<HookHarness
					board={board}
					currentProjectId="project-1"
					onDetailClosed={onDetailClosed}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		act(() => {
			requireSnapshot(latestSnapshot).setSelectedTaskId("task-1");
		});

		act(() => {
			root.render(
				<HookHarness
					board={board}
					currentProjectId="project-2"
					onDetailClosed={onDetailClosed}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBe("task-1");
		expect(onDetailClosed).not.toHaveBeenCalled();
	});

	it("opens a requested task after switching from the unified board", () => {
		const unifiedBoard: BoardData = {
			...createBoard(),
			columns: createBoard().columns.map((column) =>
				column.id === "in_progress"
					? {
							...column,
							cards: [
								...column.cards,
								{
									id: "task-requested",
									title: "Requested task",
									startInPlanMode: false,
									baseRef: "main",
									createdAt: 2,
									updatedAt: 2,
								},
							],
						}
					: column,
			),
		};
		let latestSnapshot: HookSnapshot | null = null;
		const onSelectProject = vi.fn();

		act(() => {
			root.render(
				<HookHarness
					board={unifiedBoard}
					currentProjectId="project-1"
					onSelectProject={onSelectProject}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		act(() => {
			requireSnapshot(latestSnapshot).handleProjectTaskSelect("project-2", "task-requested");
		});

		expect(onSelectProject).toHaveBeenCalledWith("project-2");
		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBe("task-requested");

		act(() => {
			root.render(
				<HookHarness
					board={unifiedBoard}
					currentProjectId="project-2"
					onSelectProject={onSelectProject}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBe("task-requested");
	});

	it("waits for the task catalog before closing an unresolved URL selection", () => {
		let latestSnapshot: HookSnapshot | null = null;
		const onDetailClosed = vi.fn();

		window.history.replaceState({}, "", "/project-1?task=missing-task");
		act(() => {
			root.render(
				<HookHarness
					board={createBoard()}
					currentProjectId="project-1"
					isTaskCatalogReady={false}
					onDetailClosed={onDetailClosed}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBe("missing-task");
		expect(onDetailClosed).not.toHaveBeenCalled();

		act(() => {
			root.render(
				<HookHarness
					board={createBoard()}
					currentProjectId="project-1"
					onDetailClosed={onDetailClosed}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).selectedTaskId).toBeNull();
		expect(onDetailClosed).toHaveBeenCalled();
	});
});
