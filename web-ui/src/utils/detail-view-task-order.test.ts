import { describe, expect, it } from "vitest";

import type { BoardCard, BoardData } from "@/types";
import {
	getNextDetailTaskIdAfterTrashMove,
	getPreferredTaskIdForProjectSwitch,
	isDetailViewColumnId,
} from "@/utils/detail-view-task-order";

function createTask(id: string): BoardCard {
	return {
		id,
		title: id,
		prompt: "",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("isDetailViewColumnId", () => {
	it("returns true only for in-progress and review-like columns", () => {
		expect(isDetailViewColumnId("in_progress")).toBe(true);
		expect(isDetailViewColumnId("review")).toBe(true);
		expect(isDetailViewColumnId("on_hold")).toBe(true);
		expect(isDetailViewColumnId("backlog")).toBe(false);
		expect(isDetailViewColumnId("trash")).toBe(false);
	});
});

describe("getPreferredTaskIdForProjectSwitch", () => {
	it("uses the top review task before in-progress and done tasks", () => {
		expect(
			getPreferredTaskIdForProjectSwitch({
				columns: [
					{ id: "backlog", title: "Backlog", cards: [] },
					{ id: "in_progress", title: "In Progress", cards: [createTask("in-progress-top")] },
					{ id: "review", title: "Review", cards: [createTask("review-top"), createTask("review-next")] },
					{ id: "trash", title: "Done", cards: [createTask("done-top")] },
				],
				dependencies: [],
			}),
		).toBe("review-top");
	});

	it("falls back from in-progress to done and ignores backlog and on-hold tasks", () => {
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [createTask("backlog-top")] },
				{ id: "in_progress", title: "In Progress", cards: [createTask("in-progress-top")] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "on_hold", title: "On Hold", cards: [createTask("on-hold-top")] },
				{ id: "trash", title: "Done", cards: [createTask("done-top")] },
			],
			dependencies: [],
		};

		expect(getPreferredTaskIdForProjectSwitch(board)).toBe("in-progress-top");
		board.columns[1] = { id: "in_progress", title: "In Progress", cards: [] };
		expect(getPreferredTaskIdForProjectSwitch(board)).toBe("done-top");
		board.columns[4] = { id: "trash", title: "Done", cards: [] };
		expect(getPreferredTaskIdForProjectSwitch(board)).toBeNull();
	});
});

describe("getNextDetailTaskIdAfterTrashMove", () => {
	it("prefers the next detail task when available", () => {
		const nextTaskId = getNextDetailTaskIdAfterTrashMove(
			{
				columns: [
					{
						id: "backlog",
						title: "Backlog",
						cards: [
							{
								id: "b1",
								title: "b1",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{
						id: "in_progress",
						title: "In Progress",
						cards: [
							{
								id: "i1",
								title: "i1",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
							{
								id: "i2",
								title: "i2",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{
						id: "review",
						title: "Review",
						cards: [
							{
								id: "r1",
								title: "r1",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{ id: "trash", title: "Done", cards: [] },
				],
				dependencies: [],
			},
			"i1",
		);

		expect(nextTaskId).toBe("i2");
	});

	it("falls back to previous detail task when removing the last detail task", () => {
		const nextTaskId = getNextDetailTaskIdAfterTrashMove(
			{
				columns: [
					{ id: "backlog", title: "Backlog", cards: [] },
					{
						id: "in_progress",
						title: "In Progress",
						cards: [
							{
								id: "i1",
								title: "i1",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{
						id: "review",
						title: "Review",
						cards: [
							{
								id: "r1",
								title: "r1",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{ id: "trash", title: "Done", cards: [] },
				],
				dependencies: [],
			},
			"r1",
		);

		expect(nextTaskId).toBe("i1");
	});

	it("returns first detail task when target task is not in detail columns", () => {
		const nextTaskId = getNextDetailTaskIdAfterTrashMove(
			{
				columns: [
					{
						id: "backlog",
						title: "Backlog",
						cards: [
							{
								id: "b1",
								title: "b1",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{
						id: "in_progress",
						title: "In Progress",
						cards: [
							{
								id: "i1",
								title: "i1",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{
						id: "review",
						title: "Review",
						cards: [
							{
								id: "r1",
								title: "r1",
								prompt: "",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{ id: "trash", title: "Done", cards: [] },
				],
				dependencies: [],
			},
			"b1",
		);

		expect(nextTaskId).toBe("i1");
	});

	it("returns null when there are no detail tasks", () => {
		const nextTaskId = getNextDetailTaskIdAfterTrashMove(
			{
				columns: [
					{
						id: "backlog",
						title: "Backlog",
						cards: [
							{
								id: "b1",
								title: "b1",
								prompt: "",
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
				dependencies: [],
			},
			"b1",
		);

		expect(nextTaskId).toBeNull();
	});
});
