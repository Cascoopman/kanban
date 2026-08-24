import { describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import { mergeWorkspaceBoards } from "@/runtime/merge-workspace-board";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";

function createCard(id: string, title: string, updatedAt = 1): BoardCard {
	return {
		id,
		title,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt,
	};
}

function createBoard(cardsByColumn: Partial<Record<BoardColumnId, BoardCard[]>>): BoardData {
	return {
		columns: createInitialBoardData().columns.map((column) => ({
			...column,
			cards: cardsByColumn[column.id] ?? [],
		})),
		dependencies: [],
	};
}

describe("mergeWorkspaceBoards", () => {
	it("merges a local field edit with a remote card move", () => {
		const base = createBoard({ in_progress: [createCard("task-1", "Original")] });
		const local = createBoard({ in_progress: [createCard("task-1", "Local title", 2)] });
		const remote = createBoard({ review: [createCard("task-1", "Original", 3)] });

		const result = mergeWorkspaceBoards(base, local, remote);

		expect(result.status).toBe("merged");
		if (result.status !== "merged") {
			return;
		}
		expect(result.board.columns.find((column) => column.id === "review")?.cards).toEqual([
			createCard("task-1", "Local title", 3),
		]);
	});

	it("merges independent additions from local and remote writers", () => {
		const base = createBoard({});
		const local = createBoard({ in_progress: [createCard("local-task", "Local")] });
		const remote = createBoard({ in_progress: [createCard("remote-task", "Remote")] });

		const result = mergeWorkspaceBoards(base, local, remote);

		expect(result.status).toBe("merged");
		if (result.status !== "merged") {
			return;
		}
		expect(result.board.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id)).toEqual([
			"remote-task",
			"local-task",
		]);
	});

	it("preserves the local value when both writers change the same card field", () => {
		const base = createBoard({ in_progress: [createCard("task-1", "Original")] });
		const local = createBoard({ in_progress: [createCard("task-1", "Local title", 2)] });
		const remote = createBoard({ in_progress: [createCard("task-1", "Remote title", 3)] });

		const result = mergeWorkspaceBoards(base, local, remote);

		expect(result.status).toBe("merged");
		if (result.status !== "merged") {
			return;
		}
		expect(result.board.columns.find((column) => column.id === "in_progress")?.cards).toEqual([
			createCard("task-1", "Local title", 3),
		]);
	});

	it("preserves the local move when both writers move the same card to different columns", () => {
		const base = createBoard({ in_progress: [createCard("task-1", "Original")] });
		const local = createBoard({ review: [createCard("task-1", "Original", 2)] });
		const remote = createBoard({ on_hold: [createCard("task-1", "Original", 3)] });

		const result = mergeWorkspaceBoards(base, local, remote);

		expect(result.status).toBe("merged");
		if (result.status !== "merged") {
			return;
		}
		expect(result.board.columns.find((column) => column.id === "review")?.cards).toEqual([
			createCard("task-1", "Original", 3),
		]);
	});

	it("preserves a modified ticket when the concurrent writer deletes it", () => {
		const base = createBoard({ in_progress: [createCard("task-1", "Original")] });
		const local = createBoard({ in_progress: [createCard("task-1", "Local title", 2)] });
		const remote = createBoard({});

		const result = mergeWorkspaceBoards(base, local, remote);

		expect(result.status).toBe("merged");
		if (result.status !== "merged") {
			return;
		}
		expect(result.board.columns.find((column) => column.id === "in_progress")?.cards).toEqual([
			createCard("task-1", "Local title", 2),
		]);
	});

	it("merges independent dependency additions", () => {
		const base = createBoard({ in_progress: [createCard("a", "A"), createCard("b", "B"), createCard("c", "C")] });
		const local = { ...base, dependencies: [{ id: "a-b", taskId: "a", dependsOnTaskId: "b", createdAt: 1 }] };
		const remote = { ...base, dependencies: [{ id: "c-b", taskId: "c", dependsOnTaskId: "b", createdAt: 2 }] };

		const result = mergeWorkspaceBoards(base, local, remote);
		expect(result.status).toBe("merged");
		if (result.status === "merged")
			expect(result.board.dependencies.map((dependency) => dependency.id)).toEqual(["a-b", "c-b"]);
	});

	it("preserves dependency removal during an unrelated remote card move", () => {
		const base = createBoard({ in_progress: [createCard("a", "A"), createCard("b", "B")] });
		base.dependencies = [{ id: "a-b", taskId: "a", dependsOnTaskId: "b", createdAt: 1 }];
		const local = { ...base, dependencies: [] };
		const remote = createBoard({ in_progress: [createCard("a", "A")], review: [createCard("b", "B", 2)] });
		remote.dependencies = [...base.dependencies];

		const result = mergeWorkspaceBoards(base, local, remote);
		expect(result.status).toBe("merged");
		if (result.status === "merged") expect(result.board.dependencies).toEqual([]);
	});

	it("reports a conflict when concurrent dependency additions form a cycle", () => {
		const base = createBoard({ in_progress: [createCard("a", "A"), createCard("b", "B")] });
		const local = { ...base, dependencies: [{ id: "a-b", taskId: "a", dependsOnTaskId: "b", createdAt: 1 }] };
		const remote = { ...base, dependencies: [{ id: "b-a", taskId: "b", dependsOnTaskId: "a", createdAt: 2 }] };

		expect(mergeWorkspaceBoards(base, local, remote)).toEqual({ status: "conflict" });
	});
});
