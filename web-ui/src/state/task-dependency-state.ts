import { canCreateTaskDependency } from "@runtime-task-dependency-graph";

import type { BoardCard, BoardData, BoardDependency } from "@/types";

function isSameProject(card: BoardCard, dependency: BoardDependency): boolean {
	return dependency.projectId === undefined || dependency.projectId === card.projectId;
}

export function findBoardTask(board: BoardData, taskId: string, projectId?: string): BoardCard | null {
	for (const column of board.columns) {
		const task = column.cards.find(
			(card) =>
				card.id === taskId &&
				(projectId === undefined || card.projectId === undefined || card.projectId === projectId),
		);
		if (task) return task;
	}
	return null;
}

export function isTaskDone(board: BoardData, taskId: string, projectId?: string): boolean {
	return (
		board.columns
			.find((column) => column.id === "trash")
			?.cards.some(
				(card) =>
					card.id === taskId &&
					(projectId === undefined || card.projectId === undefined || card.projectId === projectId),
			) ?? false
	);
}

export function getTaskDependencies(board: BoardData, task: BoardCard): BoardDependency[] {
	return board.dependencies.filter((dependency) => dependency.taskId === task.id && isSameProject(task, dependency));
}

export function getTaskDependents(board: BoardData, task: BoardCard): BoardDependency[] {
	return board.dependencies.filter(
		(dependency) => dependency.dependsOnTaskId === task.id && isSameProject(task, dependency),
	);
}

export function getUnresolvedTaskDependencies(board: BoardData, task: BoardCard): BoardDependency[] {
	return getTaskDependencies(board, task).filter(
		(dependency) => !isTaskDone(board, dependency.dependsOnTaskId, task.projectId),
	);
}

export function canAddBoardTaskDependency(board: BoardData, task: BoardCard, dependsOnTaskId: string): boolean {
	const projectDependencies = board.dependencies.filter((dependency) => isSameProject(task, dependency));
	return (
		Boolean(findBoardTask(board, dependsOnTaskId, task.projectId)) &&
		canCreateTaskDependency(projectDependencies, task.id, dependsOnTaskId)
	);
}
