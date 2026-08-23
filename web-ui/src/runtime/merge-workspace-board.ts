import type { BoardCard, BoardColumnId, BoardData } from "@/types";

export type WorkspaceBoardMergeResult = { status: "merged"; board: BoardData } | { status: "conflict" };

interface PositionedCard {
	card: BoardCard;
	columnId: BoardColumnId;
}

const CARD_MERGE_KEYS = [
	"title",
	"startInPlanMode",
	"agentId",
	"branchedFromTaskId",
	"baseRef",
	"createdAt",
	"projectId",
	"projectName",
	"projectPath",
] as const satisfies ReadonlyArray<keyof BoardCard>;

function valuesEqual(left: unknown, right: unknown): boolean {
	return Object.is(left, right);
}

export function areWorkspaceBoardsEqual(left: BoardData, right: BoardData): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function flattenBoard(board: BoardData): Map<string, PositionedCard> | null {
	const cards = new Map<string, PositionedCard>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (cards.has(card.id)) {
				return null;
			}
			cards.set(card.id, { card, columnId: column.id });
		}
	}
	return cards;
}

function positionedCardsEqual(left: PositionedCard | undefined, right: PositionedCard | undefined): boolean {
	if (!left || !right) {
		return left === right;
	}
	return left.columnId === right.columnId && valuesEqual(JSON.stringify(left.card), JSON.stringify(right.card));
}

function mergeValue<T>(base: T, local: T, remote: T): { merged: true; value: T } | { merged: false } {
	if (valuesEqual(local, remote)) {
		return { merged: true, value: local };
	}
	if (valuesEqual(local, base)) {
		return { merged: true, value: remote };
	}
	if (valuesEqual(remote, base)) {
		return { merged: true, value: local };
	}
	// Both writers changed the same value. Keep the in-browser edit: it is the
	// only copy that may not exist anywhere else yet, while the remote value is
	// already durable and remains available as the next merge baseline.
	return { merged: true, value: local };
}

function mergeExistingCard(base: PositionedCard, local: PositionedCard, remote: PositionedCard): PositionedCard | null {
	const mergedColumn = mergeValue(base.columnId, local.columnId, remote.columnId);
	if (!mergedColumn.merged) {
		return null;
	}

	const mergedCard: BoardCard = {
		id: base.card.id,
		title: base.card.title,
		startInPlanMode: base.card.startInPlanMode,
		baseRef: base.card.baseRef,
		createdAt: base.card.createdAt,
		updatedAt: Math.max(base.card.updatedAt, local.card.updatedAt, remote.card.updatedAt),
	};
	for (const key of CARD_MERGE_KEYS) {
		const merged = mergeValue(base.card[key], local.card[key], remote.card[key]);
		if (!merged.merged) {
			return null;
		}
		if (merged.value !== undefined) {
			Object.assign(mergedCard, { [key]: merged.value });
		}
	}

	return {
		card: mergedCard,
		columnId: mergedColumn.value,
	};
}

function getColumnOrder(board: BoardData, columnId: BoardColumnId, includedTaskIds: Set<string>): string[] {
	const column = board.columns.find((candidate) => candidate.id === columnId);
	return column?.cards.map((card) => card.id).filter((taskId) => includedTaskIds.has(taskId)) ?? [];
}

function getOrderRelation(order: readonly string[], left: string, right: string): -1 | 1 | null {
	const leftIndex = order.indexOf(left);
	const rightIndex = order.indexOf(right);
	if (leftIndex < 0 || rightIndex < 0) {
		return null;
	}
	return leftIndex < rightIndex ? -1 : 1;
}

function mergeOrderRelation(
	base: -1 | 1 | null,
	local: -1 | 1 | null,
	remote: -1 | 1 | null,
): -1 | 1 | null | "conflict" {
	if (local === remote) {
		return local;
	}
	if (local === null) {
		return remote;
	}
	if (remote === null) {
		return local;
	}
	if (local === base) {
		return remote;
	}
	if (remote === base) {
		return local;
	}
	return "conflict";
}

function mergeColumnOrder(
	base: BoardData,
	local: BoardData,
	remote: BoardData,
	columnId: BoardColumnId,
	taskIds: readonly string[],
): string[] | null {
	const includedTaskIds = new Set(taskIds);
	const baseOrder = getColumnOrder(base, columnId, includedTaskIds);
	const localOrder = getColumnOrder(local, columnId, includedTaskIds);
	const remoteOrder = getColumnOrder(remote, columnId, includedTaskIds);
	const outgoing = new Map(taskIds.map((taskId) => [taskId, new Set<string>()]));
	const incomingCount = new Map(taskIds.map((taskId) => [taskId, 0]));

	for (let leftIndex = 0; leftIndex < taskIds.length; leftIndex += 1) {
		const left = taskIds[leftIndex];
		if (!left) {
			continue;
		}
		for (let rightIndex = leftIndex + 1; rightIndex < taskIds.length; rightIndex += 1) {
			const right = taskIds[rightIndex];
			if (!right) {
				continue;
			}
			const relation = mergeOrderRelation(
				getOrderRelation(baseOrder, left, right),
				getOrderRelation(localOrder, left, right),
				getOrderRelation(remoteOrder, left, right),
			);
			if (relation === "conflict") {
				return null;
			}
			if (relation === null) {
				continue;
			}
			const before = relation === -1 ? left : right;
			const after = relation === -1 ? right : left;
			const neighbors = outgoing.get(before);
			if (!neighbors || neighbors.has(after)) {
				continue;
			}
			neighbors.add(after);
			incomingCount.set(after, (incomingCount.get(after) ?? 0) + 1);
		}
	}

	const fallbackRank = new Map<string, number>();
	for (const order of [remoteOrder, localOrder, baseOrder, taskIds]) {
		for (const taskId of order) {
			if (!fallbackRank.has(taskId)) {
				fallbackRank.set(taskId, fallbackRank.size);
			}
		}
	}
	const available = taskIds.filter((taskId) => incomingCount.get(taskId) === 0);
	available.sort((left, right) => (fallbackRank.get(left) ?? 0) - (fallbackRank.get(right) ?? 0));
	const mergedOrder: string[] = [];
	while (available.length > 0) {
		const next = available.shift();
		if (!next) {
			break;
		}
		mergedOrder.push(next);
		for (const neighbor of outgoing.get(next) ?? []) {
			const nextIncomingCount = (incomingCount.get(neighbor) ?? 0) - 1;
			incomingCount.set(neighbor, nextIncomingCount);
			if (nextIncomingCount === 0) {
				available.push(neighbor);
				available.sort((left, right) => (fallbackRank.get(left) ?? 0) - (fallbackRank.get(right) ?? 0));
			}
		}
	}

	return mergedOrder.length === taskIds.length ? mergedOrder : null;
}

export function mergeWorkspaceBoards(base: BoardData, local: BoardData, remote: BoardData): WorkspaceBoardMergeResult {
	if (areWorkspaceBoardsEqual(local, remote)) {
		return { status: "merged", board: local };
	}
	if (areWorkspaceBoardsEqual(local, base)) {
		return { status: "merged", board: remote };
	}
	if (areWorkspaceBoardsEqual(remote, base)) {
		return { status: "merged", board: local };
	}

	const baseCards = flattenBoard(base);
	const localCards = flattenBoard(local);
	const remoteCards = flattenBoard(remote);
	if (!baseCards || !localCards || !remoteCards) {
		return { status: "conflict" };
	}

	const mergedCards = new Map<string, PositionedCard>();
	const taskIds = new Set([...baseCards.keys(), ...localCards.keys(), ...remoteCards.keys()]);
	for (const taskId of taskIds) {
		const baseCard = baseCards.get(taskId);
		const localCard = localCards.get(taskId);
		const remoteCard = remoteCards.get(taskId);
		if (!baseCard) {
			if (localCard && remoteCard && !positionedCardsEqual(localCard, remoteCard)) {
				return { status: "conflict" };
			}
			const addedCard = localCard ?? remoteCard;
			if (addedCard) {
				mergedCards.set(taskId, addedCard);
			}
			continue;
		}
		if (!localCard || !remoteCard) {
			const remainingCard = localCard ?? remoteCard;
			if (remainingCard && !positionedCardsEqual(baseCard, remainingCard)) {
				// A changed ticket must survive a concurrent deletion. Deleting an
				// unchanged ticket remains safe and is handled by the branch below.
				mergedCards.set(taskId, remainingCard);
			}
			continue;
		}
		const mergedCard = mergeExistingCard(baseCard, localCard, remoteCard);
		if (!mergedCard) {
			return { status: "conflict" };
		}
		mergedCards.set(taskId, mergedCard);
	}

	const mergedColumns: BoardData["columns"] = [];
	for (const column of remote.columns) {
		const columnTaskIds = [...mergedCards.entries()]
			.filter(([, positionedCard]) => positionedCard.columnId === column.id)
			.map(([taskId]) => taskId);
		const mergedOrder = mergeColumnOrder(base, local, remote, column.id, columnTaskIds);
		if (!mergedOrder) {
			return { status: "conflict" };
		}
		mergedColumns.push({
			...column,
			cards: mergedOrder
				.map((taskId) => mergedCards.get(taskId)?.card)
				.filter((card): card is BoardCard => Boolean(card)),
		});
	}

	return {
		status: "merged",
		board: {
			...remote,
			columns: mergedColumns,
		},
	};
}
