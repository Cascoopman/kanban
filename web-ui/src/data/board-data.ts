import type { BoardColumn, BoardColumnId, BoardData } from "@/types";

export const BOARD_COLUMN_TITLES: Record<BoardColumnId, string> = {
	in_progress: "In Progress",
	review: "In Review / Blocked",
	on_hold: "On Hold",
	trash: "Done",
};

const columnOrder = (Object.entries(BOARD_COLUMN_TITLES) as Array<[BoardColumnId, string]>).map(([id, title]) => ({
	id,
	title,
}));

function createEmptyColumn(id: BoardColumnId, title: string): BoardColumn {
	return {
		id,
		title,
		cards: [],
	};
}

export function createInitialBoardData(): BoardData {
	return {
		columns: columnOrder.map((column) => createEmptyColumn(column.id, column.title)),
		dependencies: [],
	};
}
