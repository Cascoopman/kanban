import { type BoardColumnId, type BoardData, isReviewLikeColumnId } from "@/types";

const PROJECT_SWITCH_TASK_COLUMN_PRIORITY: readonly BoardColumnId[] = ["review", "in_progress", "trash"];

export function isDetailViewColumnId(columnId: BoardColumnId): boolean {
	return columnId === "in_progress" || isReviewLikeColumnId(columnId);
}

export function getPreferredTaskIdForProjectSwitch(board: BoardData): string | null {
	for (const columnId of PROJECT_SWITCH_TASK_COLUMN_PRIORITY) {
		const column = board.columns.find((candidate) => candidate.id === columnId);
		const firstCard = column?.cards[0];
		if (firstCard) {
			return firstCard.id;
		}
	}

	return null;
}

export function getNextDetailTaskIdAfterTrashMove(board: BoardData, taskId: string): string | null {
	const detailTaskIds: string[] = [];
	for (const column of board.columns) {
		if (!isDetailViewColumnId(column.id)) {
			continue;
		}
		for (const card of column.cards) {
			detailTaskIds.push(card.id);
		}
	}

	const currentIndex = detailTaskIds.indexOf(taskId);
	if (currentIndex === -1) {
		return detailTaskIds[0] ?? null;
	}

	return detailTaskIds[currentIndex + 1] ?? detailTaskIds[currentIndex - 1] ?? null;
}
