import { useCallback, useMemo } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { BoardColumnId } from "@/types";
import { useRawLocalStorageValue } from "@/utils/react-use";

const BOARD_COLUMN_IDS: readonly BoardColumnId[] = ["backlog", "in_progress", "review", "on_hold", "trash"];

function isBoardColumnId(value: string): value is BoardColumnId {
	return BOARD_COLUMN_IDS.some((columnId) => columnId === value);
}

function serializeHiddenColumnIds(columnIds: Iterable<BoardColumnId>): string {
	const hiddenColumnIds = new Set(columnIds);
	return BOARD_COLUMN_IDS.filter((columnId) => hiddenColumnIds.has(columnId)).join(",");
}

export function normalizeStoredHiddenColumnIds(value: string): string {
	return serializeHiddenColumnIds(value.split(",").filter(isBoardColumnId));
}

export function useBoardColumnVisibility(): {
	isColumnHidden: (columnId: BoardColumnId) => boolean;
	hideColumn: (columnId: BoardColumnId) => void;
	showColumn: (columnId: BoardColumnId) => void;
} {
	const [serializedHiddenColumnIds, setSerializedHiddenColumnIds] = useRawLocalStorageValue(
		LocalStorageKey.BoardHiddenColumns,
		"",
		normalizeStoredHiddenColumnIds,
	);
	const hiddenColumnIds = useMemo(
		() => new Set(serializedHiddenColumnIds.split(",").filter(isBoardColumnId)),
		[serializedHiddenColumnIds],
	);

	const isColumnHidden = useCallback((columnId: BoardColumnId) => hiddenColumnIds.has(columnId), [hiddenColumnIds]);
	const hideColumn = useCallback(
		(columnId: BoardColumnId) => {
			setSerializedHiddenColumnIds((currentValue) => {
				const nextHiddenColumnIds = new Set(currentValue.split(",").filter(isBoardColumnId));
				nextHiddenColumnIds.add(columnId);
				return serializeHiddenColumnIds(nextHiddenColumnIds);
			});
		},
		[setSerializedHiddenColumnIds],
	);
	const showColumn = useCallback(
		(columnId: BoardColumnId) => {
			setSerializedHiddenColumnIds((currentValue) => {
				const nextHiddenColumnIds = new Set(currentValue.split(",").filter(isBoardColumnId));
				nextHiddenColumnIds.delete(columnId);
				return serializeHiddenColumnIds(nextHiddenColumnIds);
			});
		},
		[setSerializedHiddenColumnIds],
	);

	useLayoutResetEffect(() => {
		setSerializedHiddenColumnIds("");
	});

	return {
		isColumnHidden,
		hideColumn,
		showColumn,
	};
}
