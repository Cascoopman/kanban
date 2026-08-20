import type { RuntimeAgentId, RuntimeBoardColumnId, RuntimeTaskImage } from "@/runtime/types";

export type BoardColumnId = RuntimeBoardColumnId;

export function isReviewLikeColumnId(columnId: BoardColumnId | string): boolean {
	return columnId === "review" || columnId === "on_hold";
}

export type TaskImage = RuntimeTaskImage;

export interface BoardCard {
	id: string;
	title: string;
	prompt: string;
	startInPlanMode: boolean;
	images?: TaskImage[];
	agentId?: RuntimeAgentId;
	branchedFromTaskId?: string;
	baseRef: string;
	createdAt: number;
	updatedAt: number;
}

export interface BoardColumn {
	id: BoardColumnId;
	title: string;
	cards: BoardCard[];
}

export interface BoardDependency {
	id: string;
	fromTaskId: string;
	toTaskId: string;
	createdAt: number;
}

export interface BoardData {
	columns: BoardColumn[];
	dependencies: BoardDependency[];
}

export interface ReviewTaskWorkspaceSnapshot {
	taskId: string;
	path: string;
	branch: string | null;
	isDetached: boolean;
	headCommit: string | null;
	changedFiles: number | null;
	additions: number | null;
	deletions: number | null;
}

export interface CardSelection {
	card: BoardCard;
	column: BoardColumn;
	allColumns: BoardColumn[];
}
