import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import type { RuntimeWorkspaceStateResponse } from "@/runtime/types";
import { type UseWorkspacePersistenceParams, useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { WorkspaceStateConflictError } from "@/runtime/workspace-state-query";
import type { BoardData } from "@/types";

const WORKSPACE_ID = "project-a";

function createBoard(title: string, columnId: "in_progress" | "review" = "in_progress", updatedAt = 1): BoardData {
	const board = createInitialBoardData();
	return {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards:
				column.id === columnId
					? [
							{
								id: "task-1",
								title,
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt,
							},
						]
					: [],
		})),
	};
}

function createWorkspaceState(board: BoardData, revision: number): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/tmp/project-a",
		statePath: "/tmp/project-a/.kanban",
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
		board,
		sessions: {},
		revision,
	};
}

interface HarnessProps {
	board: BoardData;
	workspaceBaseBoard: BoardData;
	workspaceRevision?: number;
	persistWorkspaceState: UseWorkspacePersistenceParams["persistWorkspaceState"];
	loadWorkspaceState: UseWorkspacePersistenceParams["loadWorkspaceState"];
	resolveWorkspaceStateConflict: UseWorkspacePersistenceParams["resolveWorkspaceStateConflict"];
	onWorkspaceStateSaved: UseWorkspacePersistenceParams["onWorkspaceStateSaved"];
	onWorkspaceStateConflict: NonNullable<UseWorkspacePersistenceParams["onWorkspaceStateConflict"]>;
}

function Harness(props: HarnessProps): null {
	useWorkspacePersistence({
		board: props.board,
		workspaceBaseBoard: props.workspaceBaseBoard,
		sessions: {},
		currentProjectId: WORKSPACE_ID,
		workspaceRevision: props.workspaceRevision ?? 1,
		canPersistWorkspaceState: true,
		isDocumentVisible: true,
		isWorkspaceStateRefreshing: false,
		persistWorkspaceState: props.persistWorkspaceState,
		loadWorkspaceState: props.loadWorkspaceState,
		resolveWorkspaceStateConflict: props.resolveWorkspaceStateConflict,
		onWorkspaceStateSaved: props.onWorkspaceStateSaved,
		onWorkspaceStateConflict: props.onWorkspaceStateConflict,
	});

	return null;
}

describe("useWorkspacePersistence", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
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
		vi.useRealTimers();
	});

	function createCallbacks() {
		return {
			resolveWorkspaceStateConflict: vi.fn<UseWorkspacePersistenceParams["resolveWorkspaceStateConflict"]>(),
			onWorkspaceStateSaved: vi.fn<UseWorkspacePersistenceParams["onWorkspaceStateSaved"]>(),
			onWorkspaceStateConflict: vi.fn<NonNullable<UseWorkspacePersistenceParams["onWorkspaceStateConflict"]>>(),
		};
	}

	it("does not persist a board that matches the latest server baseline", async () => {
		const board = createBoard("Original title");
		const persistWorkspaceState = vi.fn<UseWorkspacePersistenceParams["persistWorkspaceState"]>();
		const callbacks = createCallbacks();

		await act(async () => {
			root.render(
				<Harness
					board={board}
					workspaceBaseBoard={board}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={vi.fn()}
					{...callbacks}
				/>,
			);
		});
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		expect(persistWorkspaceState).not.toHaveBeenCalled();
	});

	it("merges a local title edit with a concurrent lifecycle move and retries", async () => {
		const baseBoard = createBoard("Original title");
		const editedBoard = createBoard("Edited title", "in_progress", 2);
		const lifecycleBoard = createBoard("Original title", "review", 3);
		const mergedBoard = createBoard("Edited title", "review", 3);
		const savedState = createWorkspaceState(mergedBoard, 3);
		const persistWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["persistWorkspaceState"]>()
			.mockRejectedValueOnce(new WorkspaceStateConflictError(2))
			.mockResolvedValueOnce(savedState);
		const loadWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["loadWorkspaceState"]>()
			.mockResolvedValue(createWorkspaceState(lifecycleBoard, 2));
		const callbacks = createCallbacks();

		await act(async () => {
			root.render(
				<Harness
					board={editedBoard}
					workspaceBaseBoard={baseBoard}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={loadWorkspaceState}
					{...callbacks}
				/>,
			);
		});
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		expect(persistWorkspaceState).toHaveBeenCalledTimes(2);
		expect(persistWorkspaceState).toHaveBeenLastCalledWith({
			workspaceId: WORKSPACE_ID,
			payload: {
				board: mergedBoard,
				sessions: {},
				expectedRevision: 2,
			},
		});
		expect(callbacks.resolveWorkspaceStateConflict).not.toHaveBeenCalled();
		expect(callbacks.onWorkspaceStateConflict).not.toHaveBeenCalled();
		expect(callbacks.onWorkspaceStateSaved).toHaveBeenCalledWith(savedState, mergedBoard);
	});

	it("passes the complete server response back to sync after a successful save", async () => {
		const baseBoard = createBoard("Original title");
		const editedBoard = createBoard("Edited title", "in_progress", 2);
		const reconciledBoard = createBoard("Edited title", "review", 3);
		const savedState = createWorkspaceState(reconciledBoard, 2);
		const persistWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["persistWorkspaceState"]>()
			.mockResolvedValue(savedState);
		const callbacks = createCallbacks();

		await act(async () => {
			root.render(
				<Harness
					board={editedBoard}
					workspaceBaseBoard={baseBoard}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={vi.fn()}
					{...callbacks}
				/>,
			);
		});
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		expect(callbacks.onWorkspaceStateSaved).toHaveBeenCalledWith(savedState, editedBoard);
	});

	it("reloads and reports a genuine concurrent edit to the same field", async () => {
		const baseBoard = createBoard("Original title");
		const editedBoard = createBoard("My edit", "in_progress", 2);
		const concurrentBoard = createBoard("Concurrent edit", "in_progress", 3);
		const persistWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["persistWorkspaceState"]>()
			.mockRejectedValue(new WorkspaceStateConflictError(2));
		const loadWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["loadWorkspaceState"]>()
			.mockResolvedValue(createWorkspaceState(concurrentBoard, 2));
		const callbacks = createCallbacks();

		await act(async () => {
			root.render(
				<Harness
					board={editedBoard}
					workspaceBaseBoard={baseBoard}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={loadWorkspaceState}
					{...callbacks}
				/>,
			);
		});
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		expect(persistWorkspaceState).toHaveBeenCalledTimes(1);
		expect(callbacks.resolveWorkspaceStateConflict).toHaveBeenCalledOnce();
		expect(callbacks.onWorkspaceStateConflict).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			currentRevision: 2,
		});
	});
});
