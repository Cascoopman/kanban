import type { DropResult } from "@hello-pangea/dnd";
import { useMemo } from "react";

import { BOARD_COLUMN_TITLES } from "@/data/board-data";
import type { RuntimeProjectBoardSnapshot, RuntimeProjectSummary, RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardColumnId, BoardData } from "@/types";

interface UseProjectBoardsInput {
	projects: RuntimeProjectSummary[];
	projectBoards: RuntimeProjectBoardSnapshot[];
	currentProjectId: string | null;
	currentBoard: BoardData;
	currentSessions: Record<string, RuntimeTaskSessionSummary>;
	canUseCurrentBoard: boolean;
}

export interface ProjectBoardsResult {
	snapshots: RuntimeProjectBoardSnapshot[];
	isLoading: boolean;
	error: Error | null;
}

export interface ProjectBoardMove {
	projectId: string;
	taskId: string;
	sourceColumnId: BoardColumnId;
	destinationColumnId: BoardColumnId;
	destinationIndex: number;
	result: DropResult;
}

export function createProjectBoardMove(board: BoardData, result: DropResult): ProjectBoardMove | null {
	if (!result.destination) {
		return null;
	}
	const sourceColumn = board.columns.find((column) => column.cards.some((card) => card.id === result.draggableId));
	const card = sourceColumn?.cards.find((candidate) => candidate.id === result.draggableId);
	const destinationColumn = board.columns.find((column) => column.id === result.destination?.droppableId);
	if (!card?.projectId || !sourceColumn || !destinationColumn) {
		return null;
	}
	const destinationIndex = destinationColumn.cards
		.slice(0, result.destination.index)
		.filter((candidate) => candidate.projectId === card.projectId).length;
	return {
		projectId: card.projectId,
		taskId: card.id,
		sourceColumnId: sourceColumn.id,
		destinationColumnId: destinationColumn.id,
		destinationIndex,
		result,
	};
}

export function scopeProjectBoardMove(board: BoardData, move: ProjectBoardMove): DropResult | null {
	const sourceColumn = board.columns.find((column) => column.id === move.sourceColumnId);
	const destinationColumn = board.columns.find((column) => column.id === move.destinationColumnId);
	const sourceIndex = sourceColumn?.cards.findIndex((card) => card.id === move.taskId) ?? -1;
	if (sourceIndex < 0 || !destinationColumn) {
		return null;
	}
	return {
		...move.result,
		source: {
			droppableId: move.sourceColumnId,
			index: sourceIndex,
		},
		destination: {
			droppableId: move.destinationColumnId,
			index: Math.min(move.destinationIndex, destinationColumn.cards.length),
		},
	};
}

export function buildUnifiedProjectBoard(
	snapshots: RuntimeProjectBoardSnapshot[],
	visibleProjectIds: ReadonlySet<string>,
): { board: BoardData; sessions: Record<string, RuntimeTaskSessionSummary> } {
	const visibleSnapshots = snapshots.filter((snapshot) => visibleProjectIds.has(snapshot.project.id));
	const columnsById = new Map<BoardData["columns"][number]["id"], BoardData["columns"][number]>();
	const sessions: Record<string, RuntimeTaskSessionSummary> = {};
	const dependencies: BoardData["dependencies"] = [];

	for (const snapshot of visibleSnapshots) {
		for (const column of snapshot.board.columns) {
			const existing = columnsById.get(column.id) ?? {
				id: column.id,
				title: BOARD_COLUMN_TITLES[column.id],
				cards: [],
			};
			existing.cards.push(
				...column.cards.map((card) => ({
					...card,
					projectId: snapshot.project.id,
					projectName: snapshot.project.name,
					projectPath: snapshot.project.path,
				})),
			);
			columnsById.set(column.id, existing);
		}
		Object.assign(sessions, snapshot.sessions);
		dependencies.push(
			...snapshot.board.dependencies.map((dependency) => ({ ...dependency, projectId: snapshot.project.id })),
		);
	}

	const columnOrder = ["in_progress", "review", "on_hold", "trash"] as const;
	return {
		board: {
			columns: columnOrder.map(
				(columnId) =>
					columnsById.get(columnId) ?? {
						id: columnId,
						title: BOARD_COLUMN_TITLES[columnId],
						cards: [],
					},
			),
			dependencies,
		},
		sessions,
	};
}

export function useProjectBoards({
	projects,
	projectBoards,
	currentProjectId,
	currentBoard,
	currentSessions,
	canUseCurrentBoard,
}: UseProjectBoardsInput): ProjectBoardsResult {
	const snapshots = useMemo(() => {
		const fetched = projectBoards;
		if (!canUseCurrentBoard || !currentProjectId) {
			return fetched;
		}
		const currentProject = projects.find((project) => project.id === currentProjectId);
		if (!currentProject) {
			return fetched;
		}
		const currentSnapshot: RuntimeProjectBoardSnapshot = {
			project: currentProject,
			board: currentBoard,
			sessions: currentSessions,
		};
		const existingIndex = fetched.findIndex((snapshot) => snapshot.project.id === currentProjectId);
		if (existingIndex < 0) {
			return [...fetched, currentSnapshot];
		}
		return fetched.map((snapshot, index) => (index === existingIndex ? currentSnapshot : snapshot));
	}, [canUseCurrentBoard, currentBoard, currentProjectId, currentSessions, projectBoards, projects]);

	return {
		snapshots,
		isLoading: projectBoards.length === 0 && projects.length > 0,
		error: null,
	};
}
