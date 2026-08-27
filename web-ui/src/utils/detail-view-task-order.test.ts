import { describe, expect, it } from "vitest";

import type { BoardCard, BoardData } from "@/types";
import { getNextDetailTaskIdAfterTrashMove, isDetailViewColumnId } from "@/utils/detail-view-task-order";

function createTask(id: string): BoardCard {
	return { id, title: id, startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 };
}

function createBoard(): BoardData {
	return {
		columns: [
			{ id: "in_progress", title: "In Progress", cards: [createTask("active")] },
			{ id: "review", title: "Review", cards: [createTask("review")] },
			{ id: "on_hold", title: "On Hold", cards: [createTask("hold")] },
			{ id: "trash", title: "Done", cards: [createTask("done")] },
		],
	};
}

describe("detail task order", () => {
	it("includes active and review-like columns but not done", () => {
		expect(isDetailViewColumnId("in_progress")).toBe(true);
		expect(isDetailViewColumnId("review")).toBe(true);
		expect(isDetailViewColumnId("on_hold")).toBe(true);
		expect(isDetailViewColumnId("trash")).toBe(false);
	});

	it("selects the next active detail task after moving one to done", () => {
		const board = createBoard();
		board.columns.find((column) => column.id === "in_progress")!.cards.push(createTask("active-2"));
		expect(getNextDetailTaskIdAfterTrashMove(board, "active")).toBe("active-2");
	});
});
