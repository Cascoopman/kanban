import type { RuntimeBoardData, RuntimeTaskDependency } from "./api-contract";
import { canCreateTaskDependency, sanitizeTaskDependencies } from "./task-dependency-graph";

export type AddTaskDependencyFailureReason = "missing_task" | "self_dependency" | "duplicate" | "cycle";
export type AddTaskDependencyResult =
	| { added: true; board: RuntimeBoardData; dependency: RuntimeTaskDependency }
	| { added: false; board: RuntimeBoardData; reason: AddTaskDependencyFailureReason };

function collectTaskIds(board: RuntimeBoardData): Set<string> {
	return new Set(board.columns.flatMap((column) => column.cards.map((card) => card.id)));
}

export function normalizeTaskDependencies(board: RuntimeBoardData): RuntimeBoardData {
	const dependencies = sanitizeTaskDependencies(collectTaskIds(board), board.dependencies);
	if (
		dependencies.length === board.dependencies.length &&
		dependencies.every((value, index) => value === board.dependencies[index])
	) {
		return board;
	}
	return { ...board, dependencies };
}

export function addTaskDependency(
	board: RuntimeBoardData,
	taskId: string,
	dependsOnTaskId: string,
	randomUuid: () => string = () => crypto.randomUUID(),
	now: number = Date.now(),
): AddTaskDependencyResult {
	const normalizedTaskId = taskId.trim();
	const normalizedDependsOnTaskId = dependsOnTaskId.trim();
	const taskIds = collectTaskIds(board);
	if (!taskIds.has(normalizedTaskId) || !taskIds.has(normalizedDependsOnTaskId)) {
		return { added: false, board, reason: "missing_task" };
	}
	if (normalizedTaskId === normalizedDependsOnTaskId) return { added: false, board, reason: "self_dependency" };
	if (
		board.dependencies.some(
			(dependency) =>
				dependency.taskId === normalizedTaskId && dependency.dependsOnTaskId === normalizedDependsOnTaskId,
		)
	) {
		return { added: false, board, reason: "duplicate" };
	}
	if (!canCreateTaskDependency(board.dependencies, normalizedTaskId, normalizedDependsOnTaskId)) {
		return { added: false, board, reason: "cycle" };
	}
	const dependency: RuntimeTaskDependency = {
		id: randomUuid().replaceAll("-", "").slice(0, 12),
		taskId: normalizedTaskId,
		dependsOnTaskId: normalizedDependsOnTaskId,
		createdAt: now,
	};
	return { added: true, dependency, board: { ...board, dependencies: [...board.dependencies, dependency] } };
}

export function removeTaskDependency(board: RuntimeBoardData, dependencyId: string): RuntimeBoardData {
	const dependencies = board.dependencies.filter((dependency) => dependency.id !== dependencyId.trim());
	return dependencies.length === board.dependencies.length ? board : { ...board, dependencies };
}

export function removeTaskDependenciesForTasks(
	board: RuntimeBoardData,
	taskIds: ReadonlySet<string>,
): RuntimeBoardData {
	const dependencies = board.dependencies.filter(
		(dependency) => !taskIds.has(dependency.taskId) && !taskIds.has(dependency.dependsOnTaskId),
	);
	return dependencies.length === board.dependencies.length ? board : { ...board, dependencies };
}
