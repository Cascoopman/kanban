import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import type { RuntimeWorkspaceStateResponse } from "@/runtime/types";
import { type UseWorkspacePersistenceParams, useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { WorkspaceStateConflictError } from "@/runtime/workspace-state-query";
import type { BoardData } from "@/types";

const WORKSPACE_ID = "project-a";

function createBoard(title: string): BoardData {
	const board = createInitialBoardData();
	return {
		...board,
		columns: board.columns.map((column, index) =>
			index === 0
				? {
						...column,
						cards: [
							{
								id: "task-1",
								title,
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					}
				: column,
		),
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
	hydrationNonce: number;
	canPersistWorkspaceState: boolean;
	persistWorkspaceState: UseWorkspacePersistenceParams["persistWorkspaceState"];
	loadWorkspaceState: UseWorkspacePersistenceParams["loadWorkspaceState"];
	refetchWorkspaceState: UseWorkspacePersistenceParams["refetchWorkspaceState"];
	onWorkspaceRevisionChange: UseWorkspacePersistenceParams["onWorkspaceRevisionChange"];
	onWorkspaceStateConflict: NonNullable<UseWorkspacePersistenceParams["onWorkspaceStateConflict"]>;
}

function Harness(props: HarnessProps): null {
	useWorkspacePersistence({
		board: props.board,
		sessions: {},
		currentProjectId: WORKSPACE_ID,
		workspaceRevision: 1,
		hydrationNonce: props.hydrationNonce,
		canPersistWorkspaceState: props.canPersistWorkspaceState,
		isDocumentVisible: true,
		isWorkspaceStateRefreshing: false,
		persistWorkspaceState: props.persistWorkspaceState,
		loadWorkspaceState: props.loadWorkspaceState,
		refetchWorkspaceState: props.refetchWorkspaceState,
		onWorkspaceRevisionChange: props.onWorkspaceRevisionChange,
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

	it("retries an edit when only non-board workspace state changed", async () => {
		const persistedBoard = createBoard("Original title");
		const editedBoard = createBoard("Edited title");
		const persistWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["persistWorkspaceState"]>()
			.mockRejectedValueOnce(new WorkspaceStateConflictError(2))
			.mockResolvedValueOnce(createWorkspaceState(editedBoard, 3));
		const loadWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["loadWorkspaceState"]>()
			.mockResolvedValue(createWorkspaceState(persistedBoard, 2));
		const refetchWorkspaceState = vi.fn<UseWorkspacePersistenceParams["refetchWorkspaceState"]>();
		const onWorkspaceRevisionChange = vi.fn<UseWorkspacePersistenceParams["onWorkspaceRevisionChange"]>();
		const onWorkspaceStateConflict = vi.fn<NonNullable<UseWorkspacePersistenceParams["onWorkspaceStateConflict"]>>();

		await act(async () => {
			root.render(
				<Harness
					board={persistedBoard}
					hydrationNonce={0}
					canPersistWorkspaceState={false}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={loadWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
				/>,
			);
		});
		await act(async () => {
			root.render(
				<Harness
					board={persistedBoard}
					hydrationNonce={1}
					canPersistWorkspaceState={true}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={loadWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
				/>,
			);
		});
		await act(async () => {
			root.render(
				<Harness
					board={editedBoard}
					hydrationNonce={1}
					canPersistWorkspaceState={true}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={loadWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
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
				board: editedBoard,
				sessions: {},
				expectedRevision: 2,
			},
		});
		expect(refetchWorkspaceState).not.toHaveBeenCalled();
		expect(onWorkspaceStateConflict).not.toHaveBeenCalled();
		expect(onWorkspaceRevisionChange).toHaveBeenCalledWith(3);
	});

	it("reloads and reports a genuine concurrent board edit", async () => {
		const persistedBoard = createBoard("Original title");
		const editedBoard = createBoard("My edit");
		const concurrentBoard = createBoard("Concurrent edit");
		const persistWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["persistWorkspaceState"]>()
			.mockRejectedValue(new WorkspaceStateConflictError(2));
		const loadWorkspaceState = vi
			.fn<UseWorkspacePersistenceParams["loadWorkspaceState"]>()
			.mockResolvedValue(createWorkspaceState(concurrentBoard, 2));
		const refetchWorkspaceState = vi.fn<UseWorkspacePersistenceParams["refetchWorkspaceState"]>();
		const onWorkspaceRevisionChange = vi.fn<UseWorkspacePersistenceParams["onWorkspaceRevisionChange"]>();
		const onWorkspaceStateConflict = vi.fn<NonNullable<UseWorkspacePersistenceParams["onWorkspaceStateConflict"]>>();

		await act(async () => {
			root.render(
				<Harness
					board={persistedBoard}
					hydrationNonce={0}
					canPersistWorkspaceState={false}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={loadWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
				/>,
			);
		});
		await act(async () => {
			root.render(
				<Harness
					board={persistedBoard}
					hydrationNonce={1}
					canPersistWorkspaceState={true}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={loadWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
				/>,
			);
		});
		await act(async () => {
			root.render(
				<Harness
					board={editedBoard}
					hydrationNonce={1}
					canPersistWorkspaceState={true}
					persistWorkspaceState={persistWorkspaceState}
					loadWorkspaceState={loadWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
				/>,
			);
		});
		await act(async () => {
			await vi.runAllTimersAsync();
		});

		expect(persistWorkspaceState).toHaveBeenCalledTimes(1);
		expect(refetchWorkspaceState).toHaveBeenCalledOnce();
		expect(onWorkspaceStateConflict).toHaveBeenCalledWith({
			workspaceId: WORKSPACE_ID,
			currentRevision: 2,
		});
	});
});
