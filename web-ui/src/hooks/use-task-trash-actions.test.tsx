import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTaskTrashActions } from "@/hooks/use-task-trash-actions";
import type { BoardCard, BoardData } from "@/types";

const task: BoardCard = {
	id: "task-1",
	title: "Task 1",
	startInPlanMode: false,
	baseRef: "main",
	createdAt: 1,
	updatedAt: 1,
};

const nextTask: BoardCard = {
	...task,
	id: "task-2",
	title: "Task 2",
	createdAt: 2,
	updatedAt: 2,
};

function createBoard(): BoardData {
	return {
		columns: [
			{ id: "in_progress", title: "In Progress", cards: [task, nextTask] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "on_hold", title: "On Hold", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
	};
}

interface Snapshot {
	board: BoardData;
	selectedTaskId: string | null;
	confirmMoveTaskToTrash: ReturnType<typeof useTaskTrashActions>["confirmMoveTaskToTrash"];
}

function Harness({
	stopTaskSession,
	cleanupTaskWorkspace,
	onSnapshot,
}: {
	stopTaskSession: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace: (taskId: string) => Promise<unknown>;
	onSnapshot: (snapshot: Snapshot) => void;
}): null {
	const [board, setBoard] = useState(createBoard);
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(task.id);
	const actions = useTaskTrashActions({
		board,
		setBoard,
		setSelectedTaskId,
		stopTaskSession,
		cleanupTaskWorkspace,
	});

	useEffect(() => {
		onSnapshot({ board, selectedTaskId, confirmMoveTaskToTrash: actions.confirmMoveTaskToTrash });
	}, [actions.confirmMoveTaskToTrash, board, onSnapshot, selectedTaskId]);

	return null;
}

describe("useTaskTrashActions", () => {
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

	it("moves a task to done, advances selection, and cleans up both terminal sessions", async () => {
		const stopTaskSession = vi.fn(async () => {});
		const cleanupTaskWorkspace = vi.fn(async () => null);
		let snapshot!: Snapshot;
		const onSnapshot = (next: Snapshot) => {
			snapshot = next;
		};

		await act(async () => {
			root.render(
				<Harness
					stopTaskSession={stopTaskSession}
					cleanupTaskWorkspace={cleanupTaskWorkspace}
					onSnapshot={onSnapshot}
				/>,
			);
		});
		await act(async () => {
			await snapshot.confirmMoveTaskToTrash(task);
		});

		expect(snapshot.board.columns.find((column) => column.id === "trash")?.cards).toEqual([
			expect.objectContaining({ id: task.id }),
		]);
		expect(snapshot.selectedTaskId).toBe(nextTask.id);
		expect(stopTaskSession).toHaveBeenCalledWith(task.id);
		expect(stopTaskSession).toHaveBeenCalledWith(`__detail_terminal__:${task.id}`);
		expect(cleanupTaskWorkspace).toHaveBeenCalledWith(task.id);
	});
});
