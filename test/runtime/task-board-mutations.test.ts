import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import {
	addTaskDependency,
	addTaskToColumn,
	deleteTasksFromBoard,
	moveTaskToColumn,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
} from "../../src/core/task-board-mutations";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "on_hold", title: "On Hold", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

describe("deleteTasksFromBoard", () => {
	it("removes a trashed task and any dependencies that reference it", () => {
		const createA = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task A", baseRef: "main" },
			() => "aaaaa111",
		);
		const createB = addTaskToColumn(createA.board, "review", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");
		const linked = addTaskDependency(createB.board, "aaaaa", "bbbbb");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}
		const trashed = trashTaskAndGetReadyLinkedTaskIds(linked.board, "bbbbb");
		const deleted = deleteTasksFromBoard(trashed.board, ["bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds).toEqual(["bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
		expect(deleted.board.dependencies).toEqual([]);
	});

	it("removes multiple trashed tasks at once", () => {
		const createA = addTaskToColumn(createBoard(), "trash", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
		const createB = addTaskToColumn(createA.board, "trash", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");

		const deleted = deleteTasksFromBoard(createB.board, ["aaaaa", "bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds.sort()).toEqual(["aaaaa", "bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
	});
});

describe("on-hold tasks", () => {
	it("releases linked backlog tasks when an on-hold prerequisite moves to done", () => {
		const prerequisite = addTaskToColumn(
			createBoard(),
			"on_hold",
			{ prompt: "Prerequisite", baseRef: "main" },
			() => "aaaaa111",
		);
		const dependent = addTaskToColumn(
			prerequisite.board,
			"backlog",
			{ prompt: "Dependent", baseRef: "main" },
			() => "bbbbb111",
		);
		const linked = addTaskDependency(dependent.board, dependent.task.id, prerequisite.task.id);
		expect(linked.added).toBe(true);

		const trashed = trashTaskAndGetReadyLinkedTaskIds(linked.board, prerequisite.task.id);
		expect(trashed.readyTaskIds).toEqual([dependent.task.id]);
	});
});

describe("task images", () => {
	it("preserves images when creating and updating tasks", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task with image",
				baseRef: "main",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			},
			() => "aaaaa111",
		);

		expect(created.task.images).toEqual([
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task with updated image",
			baseRef: "main",
			images: [
				{
					id: "img-2",
					data: "def456",
					mimeType: "image/jpeg",
				},
			],
		});

		expect(updated.task?.images).toEqual([
			{
				id: "img-2",
				data: "def456",
				mimeType: "image/jpeg",
			},
		]);
	});
});

describe("per-task agent overrides", () => {
	it("persists agentId on the card when creating a task", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Smart task", baseRef: "main", agentId: "claude" },
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBe("claude");
	});

	it("leaves override fields undefined when not provided", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Default task", baseRef: "main" },
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBeUndefined();
	});

	it("updates agentId from undefined to a value", () => {
		const created = addTaskToColumn(createBoard(), "backlog", { prompt: "Task", baseRef: "main" }, () => "aaaaa111");
		expect(created.task.agentId).toBeUndefined();

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentId: "codex",
		});

		expect(updated.updated).toBe(true);
		expect(updated.task?.agentId).toBe("codex");
	});

	it("preserves existing overrides when update input omits them (undefined)", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				agentId: "claude",
			},
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Updated prompt",
			baseRef: "main",
			// agentId is undefined, so the existing override should persist.
		});

		expect(updated.task?.agentId).toBe("claude");
	});

	it("clears overrides when update input provides null", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				agentId: "codex",
			},
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentId: null,
		});

		expect(updated.task?.agentId).toBeUndefined();
	});

	it("preserves overrides across move operations", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Movable task",
				baseRef: "main",
				agentId: "claude",
			},
			() => "aaaaa111",
		);

		const moved = moveTaskToColumn(created.board, created.task.id, "in_progress");

		expect(moved.moved).toBe(true);
		expect(moved.task?.agentId).toBe("claude");
	});
});
