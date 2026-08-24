export interface TaskDependencyEdge {
	id: string;
	taskId: string;
	dependsOnTaskId: string;
	createdAt: number;
}

export type TaskDependencyValidationIssue =
	| { code: "duplicate_id"; dependencyIndex: number; dependencyId: string }
	| { code: "duplicate_link"; dependencyIndex: number; taskId: string; dependsOnTaskId: string }
	| { code: "missing_task"; dependencyIndex: number; taskId: string }
	| { code: "self_dependency"; dependencyIndex: number; taskId: string }
	| { code: "cycle"; dependencyIndex: number; taskId: string; dependsOnTaskId: string };

function createLinkKey(taskId: string, dependsOnTaskId: string): string {
	return `${taskId}\0${dependsOnTaskId}`;
}

export function hasDependencyPath(
	dependencies: readonly TaskDependencyEdge[],
	fromTaskId: string,
	toTaskId: string,
): boolean {
	const pending = [fromTaskId];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const taskId = pending.pop();
		if (!taskId || visited.has(taskId)) continue;
		if (taskId === toTaskId) return true;
		visited.add(taskId);
		for (const dependency of dependencies) {
			if (dependency.taskId === taskId) pending.push(dependency.dependsOnTaskId);
		}
	}
	return false;
}

export function validateTaskDependencyGraph(
	taskIds: ReadonlySet<string>,
	dependencies: readonly TaskDependencyEdge[],
): TaskDependencyValidationIssue[] {
	const issues: TaskDependencyValidationIssue[] = [];
	const accepted: TaskDependencyEdge[] = [];
	const dependencyIds = new Set<string>();
	const links = new Set<string>();

	for (const [dependencyIndex, dependency] of dependencies.entries()) {
		if (dependencyIds.has(dependency.id)) {
			issues.push({ code: "duplicate_id", dependencyIndex, dependencyId: dependency.id });
			continue;
		}
		dependencyIds.add(dependency.id);
		if (!taskIds.has(dependency.taskId)) {
			issues.push({ code: "missing_task", dependencyIndex, taskId: dependency.taskId });
			continue;
		}
		if (!taskIds.has(dependency.dependsOnTaskId)) {
			issues.push({ code: "missing_task", dependencyIndex, taskId: dependency.dependsOnTaskId });
			continue;
		}
		if (dependency.taskId === dependency.dependsOnTaskId) {
			issues.push({ code: "self_dependency", dependencyIndex, taskId: dependency.taskId });
			continue;
		}
		const linkKey = createLinkKey(dependency.taskId, dependency.dependsOnTaskId);
		if (links.has(linkKey)) {
			issues.push({
				code: "duplicate_link",
				dependencyIndex,
				taskId: dependency.taskId,
				dependsOnTaskId: dependency.dependsOnTaskId,
			});
			continue;
		}
		if (hasDependencyPath(accepted, dependency.dependsOnTaskId, dependency.taskId)) {
			issues.push({
				code: "cycle",
				dependencyIndex,
				taskId: dependency.taskId,
				dependsOnTaskId: dependency.dependsOnTaskId,
			});
			continue;
		}
		links.add(linkKey);
		accepted.push(dependency);
	}
	return issues;
}

export function sanitizeTaskDependencies(
	taskIds: ReadonlySet<string>,
	dependencies: readonly TaskDependencyEdge[],
): TaskDependencyEdge[] {
	const rejectedIndexes = new Set(
		validateTaskDependencyGraph(taskIds, dependencies).map((issue) => issue.dependencyIndex),
	);
	return dependencies.filter((_, index) => !rejectedIndexes.has(index));
}

export function canCreateTaskDependency(
	dependencies: readonly TaskDependencyEdge[],
	taskId: string,
	dependsOnTaskId: string,
): boolean {
	if (!taskId || !dependsOnTaskId || taskId === dependsOnTaskId) return false;
	if (
		dependencies.some((dependency) => dependency.taskId === taskId && dependency.dependsOnTaskId === dependsOnTaskId)
	) {
		return false;
	}
	return !hasDependencyPath(dependencies, dependsOnTaskId, taskId);
}
