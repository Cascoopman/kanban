import { DEFAULT_TASK_TITLE_MAX_CHARS } from "@runtime-task-title";
import { describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import {
	addTaskToColumnWithResult,
	clearColumnTasks,
	findCardSelection,
	moveTaskToColumn,
	normalizeBoardData,
	updateTaskTitle,
} from "@/state/board-state";

describe("board state", () => {
	it("creates tasks directly in progress", () => {
		const created = addTaskToColumnWithResult(createInitialBoardData(), "in_progress", {
			title: "Task",
			baseRef: "main",
		});

		expect(findCardSelection(created.board, created.task.id)?.column.id).toBe("in_progress");
	});

	it("migrates persisted backlog cards into in progress and drops dependency data", () => {
		const normalized = normalizeBoardData({
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "legacy",
							title: "Legacy task",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
			],
			dependencies: [{ id: "old", fromTaskId: "legacy", toTaskId: "other", createdAt: 1 }],
		});

		expect(normalized?.columns.map((column) => column.id)).toEqual(["in_progress", "review", "on_hold", "trash"]);
		expect(normalized?.columns.find((column) => column.id === "review")?.title).toBe("In Review / Blocked");
		expect(findCardSelection(normalized!, "legacy")?.column.id).toBe("in_progress");
		expect(normalized).not.toHaveProperty("dependencies");
	});

	it("updates, moves, and clears tasks", () => {
		const created = addTaskToColumnWithResult(createInitialBoardData(), "in_progress", {
			title: "Task",
			baseRef: "main",
		});
		const renamed = updateTaskTitle(created.board, created.task.id, "Renamed");
		const reviewed = moveTaskToColumn(renamed.board, created.task.id, "review");
		const cleared = clearColumnTasks(reviewed.board, "review");

		expect(renamed.updated).toBe(true);
		expect(findCardSelection(reviewed.board, created.task.id)?.card.title).toBe("Renamed");
		expect(cleared.clearedTaskIds).toEqual([created.task.id]);
	});

	it("rejects inline title updates beyond the shared title limit", () => {
		const created = addTaskToColumnWithResult(createInitialBoardData(), "in_progress", {
			title: "Task",
			baseRef: "main",
		});

		expect(() =>
			updateTaskTitle(created.board, created.task.id, "x".repeat(DEFAULT_TASK_TITLE_MAX_CHARS + 1)),
		).toThrow(`Task title must be ${DEFAULT_TASK_TITLE_MAX_CHARS} characters or fewer.`);
	});
});
