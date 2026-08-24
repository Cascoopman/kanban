import { describe, expect, it } from "vitest";

import {
	canAddBoardTaskDependency,
	getTaskDependents,
	getUnresolvedTaskDependencies,
} from "@/state/task-dependency-state";
import type { BoardCard, BoardData } from "@/types";

function card(id: string, projectId?: string): BoardCard {
	return { id, title: id, startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1, projectId };
}

function board(): BoardData {
	return {
		columns: [
			{ id: "in_progress", title: "In Progress", cards: [card("a"), card("b")] },
			{ id: "review", title: "Review", cards: [card("c")] },
			{ id: "on_hold", title: "On Hold", cards: [] },
			{ id: "trash", title: "Done", cards: [card("done")] },
		],
		dependencies: [
			{ id: "a-b", taskId: "a", dependsOnTaskId: "b", createdAt: 1 },
			{ id: "a-done", taskId: "a", dependsOnTaskId: "done", createdAt: 2 },
			{ id: "c-a", taskId: "c", dependsOnTaskId: "a", createdAt: 3 },
		],
	};
}

describe("task dependency selectors", () => {
	it("treats only prerequisites in Done as satisfied", () => {
		const data = board();
		expect(getUnresolvedTaskDependencies(data, card("a")).map((dependency) => dependency.id)).toEqual(["a-b"]);
		expect(getTaskDependents(data, card("a")).map((dependency) => dependency.id)).toEqual(["c-a"]);
	});

	it("filters duplicates and cycle-producing candidates", () => {
		const data = board();
		expect(canAddBoardTaskDependency(data, card("a"), "b")).toBe(false);
		expect(canAddBoardTaskDependency(data, card("a"), "c")).toBe(false);
		expect(canAddBoardTaskDependency(data, card("a"), "missing")).toBe(false);
	});

	it("keeps aggregate dependencies scoped to their owning project", () => {
		const taskA = card("same", "project-a");
		const taskB = card("same", "project-b");
		const data: BoardData = {
			columns: [
				{ id: "in_progress", title: "In Progress", cards: [taskA, taskB, card("prerequisite", "project-a")] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "on_hold", title: "On Hold", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [
				{ id: "link", taskId: "same", dependsOnTaskId: "prerequisite", createdAt: 1, projectId: "project-a" },
			],
		};
		expect(getUnresolvedTaskDependencies(data, taskA)).toHaveLength(1);
		expect(getUnresolvedTaskDependencies(data, taskB)).toHaveLength(0);
	});
});
