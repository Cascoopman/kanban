import { describe, expect, it } from "vitest";

import { type RuntimeBoardData, runtimeBoardDataSchema } from "../../src/core/api-contract";
import { addTaskToColumn, deleteTasksFromBoard, moveTaskToColumn } from "../../src/core/task-board-mutations";
import { addTaskDependency, removeTaskDependency } from "../../src/core/task-dependencies";

function createBoard(): RuntimeBoardData {
	let board: RuntimeBoardData = {
		columns: [
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "In Review / Blocked", cards: [] },
			{ id: "on_hold", title: "On Hold", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
	for (const taskId of ["a", "b", "c"]) {
		board = addTaskToColumn(board, "in_progress", { taskId, title: taskId, baseRef: "main" }, () => taskId).board;
	}
	return board;
}

describe("task dependencies", () => {
	it("adds and removes a directed dependency", () => {
		const added = addTaskDependency(createBoard(), "a", "b", () => "dependency-1", 10);
		expect(added.added).toBe(true);
		if (!added.added) return;
		expect(added.dependency).toEqual({ id: "dependency1", taskId: "a", dependsOnTaskId: "b", createdAt: 10 });
		expect(removeTaskDependency(added.board, added.dependency.id).dependencies).toEqual([]);
	});

	it("rejects self-links, duplicates, missing tasks, and cycles", () => {
		const board = createBoard();
		expect(addTaskDependency(board, "a", "a")).toMatchObject({ added: false, reason: "self_dependency" });
		expect(addTaskDependency(board, "a", "missing")).toMatchObject({ added: false, reason: "missing_task" });
		const first = addTaskDependency(board, "a", "b", () => "first");
		if (!first.added) throw new Error("Expected first dependency to be added.");
		expect(addTaskDependency(first.board, "a", "b")).toMatchObject({ added: false, reason: "duplicate" });
		const second = addTaskDependency(first.board, "b", "c", () => "second");
		if (!second.added) throw new Error("Expected second dependency to be added.");
		expect(addTaskDependency(second.board, "c", "a")).toMatchObject({ added: false, reason: "cycle" });
	});

	it("keeps links when tasks move to Done and removes incident links only when tasks are deleted", () => {
		const added = addTaskDependency(createBoard(), "a", "b", () => "link");
		if (!added.added) throw new Error("Expected dependency to be added.");
		const done = moveTaskToColumn(added.board, "b", "trash");
		expect(done.board.dependencies).toEqual(added.board.dependencies);

		const deleted = deleteTasksFromBoard(done.board, ["b"]);
		expect(deleted.board.dependencies).toEqual([]);
	});

	it("rejects invalid dependency graphs at the API boundary", () => {
		const board = createBoard();
		const invalid = {
			...board,
			dependencies: [
				{ id: "one", taskId: "a", dependsOnTaskId: "b", createdAt: 1 },
				{ id: "two", taskId: "b", dependsOnTaskId: "a", createdAt: 2 },
			],
		};
		expect(runtimeBoardDataSchema.safeParse(invalid).success).toBe(false);
	});
});
