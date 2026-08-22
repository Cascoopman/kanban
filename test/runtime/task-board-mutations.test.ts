import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import {
	addTaskToColumn,
	deleteTasksFromBoard,
	getTaskColumnId,
	moveTaskToColumn,
	trashTask,
	updateTask,
} from "../../src/core/task-board-mutations";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "on_hold", title: "On Hold", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
	};
}

describe("task board mutations", () => {
	it("creates tasks directly in progress", () => {
		const result = addTaskToColumn(
			createBoard(),
			"in_progress",
			{ title: "Task", baseRef: "main" },
			() => "aaaaa111",
			100,
		);

		expect(result.task).toMatchObject({ id: "aaaaa", title: "Task", baseRef: "main", createdAt: 100 });
		expect(getTaskColumnId(result.board, result.task.id)).toBe("in_progress");
	});

	it("moves tasks through active columns and into done", () => {
		const created = addTaskToColumn(createBoard(), "in_progress", { title: "Task", baseRef: "main" }, () => "a");
		const reviewed = moveTaskToColumn(created.board, "a", "review", 200);
		const done = trashTask(reviewed.board, "a", 300);

		expect(reviewed.moved).toBe(true);
		expect(done.moved).toBe(true);
		expect(getTaskColumnId(done.board, "a")).toBe("trash");
		expect(done.task?.updatedAt).toBe(300);
	});

	it("updates and deletes tasks", () => {
		const created = addTaskToColumn(createBoard(), "in_progress", { title: "Task", baseRef: "main" }, () => "a");
		const updated = updateTask(
			created.board,
			"a",
			{
				title: "Updated",
				baseRef: "develop",
				startInPlanMode: true,
			},
			200,
		);
		const deleted = deleteTasksFromBoard(updated.board, ["a"]);

		expect(updated.task).toMatchObject({ title: "Updated", baseRef: "develop", startInPlanMode: true });
		expect(deleted.deletedTaskIds).toEqual(["a"]);
		expect(getTaskColumnId(deleted.board, "a")).toBeNull();
	});
});
