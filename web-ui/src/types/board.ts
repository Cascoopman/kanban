import type { RuntimeAgentId, RuntimeBoardColumnId, RuntimeTaskImage } from "@/runtime/types";

export type BoardColumnId = RuntimeBoardColumnId;
export type TaskImage = RuntimeTaskImage;

export function isReviewLikeColumnId(columnId: BoardColumnId | string): boolean {
	return columnId === "review" || columnId === "on_hold";
}

export interface BoardCard {
	id: string;
	title: string;
	startInPlanMode: boolean;
	agentId?: RuntimeAgentId;
	branchedFromTaskId?: string;
	baseRef: string;
	createdAt: number;
	updatedAt: number;
	projectId?: string;
	projectName?: string;
	projectPath?: string;
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
