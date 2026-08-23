import { useEffect, useRef } from "react";

import { notifyError } from "@/components/app-toaster";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";
import type { RuntimeProjectBoardSnapshot, RuntimeTaskSessionSummary } from "@/runtime/types";

export const RESTART_CONTINUATION_PROMPT = "Continue working on the task from where you left off.";

function isRestartableCliSession(summary: RuntimeTaskSessionSummary | undefined): boolean {
	return (
		summary !== undefined &&
		summary.agentId !== null &&
		summary.pid === null &&
		(summary.state === "idle" || summary.state === "interrupted" || summary.state === "awaiting_review")
	);
}

export function useResumeInterruptedTaskSessions({
	projectBoards,
	hasReceivedSnapshot,
	isRuntimeDisconnected,
	startTaskSessionForProject,
}: {
	projectBoards: RuntimeProjectBoardSnapshot[];
	hasReceivedSnapshot: boolean;
	isRuntimeDisconnected: boolean;
	startTaskSessionForProject: UseTaskSessionsResult["startTaskSessionForProject"];
}): void {
	const handledTaskIdsByProjectRef = useRef<Map<string, Set<string>>>(new Map());

	useEffect(() => {
		if (isRuntimeDisconnected) {
			handledTaskIdsByProjectRef.current.clear();
			return;
		}
		if (!hasReceivedSnapshot) {
			return;
		}

		const availableProjectIds = new Set(projectBoards.map((snapshot) => snapshot.project.id));
		for (const projectId of handledTaskIdsByProjectRef.current.keys()) {
			if (!availableProjectIds.has(projectId)) {
				handledTaskIdsByProjectRef.current.delete(projectId);
			}
		}

		for (const snapshot of projectBoards) {
			const handledTaskIds = handledTaskIdsByProjectRef.current.get(snapshot.project.id) ?? new Set<string>();
			handledTaskIdsByProjectRef.current.set(snapshot.project.id, handledTaskIds);
			const resumableColumns = snapshot.board.columns.filter(
				(column) => column.id === "in_progress" || column.id === "review",
			);
			for (const column of resumableColumns) {
				for (const task of column.cards) {
					const summary = snapshot.sessions[task.id];
					if (!isRestartableCliSession(summary)) {
						continue;
					}
					if (handledTaskIds.has(task.id)) {
						continue;
					}
					handledTaskIds.add(task.id);
					const shouldContinueWork = column.id === "in_progress";
					void startTaskSessionForProject(snapshot.project.id, task, {
						resumeExistingSession: shouldContinueWork ? "running" : "awaiting_review",
						...(shouldContinueWork ? { continuationPrompt: RESTART_CONTINUATION_PROMPT } : {}),
					}).then((result) => {
						if (!result.ok) {
							handledTaskIds.delete(task.id);
							notifyError(result.message ?? `Could not resume ${task.title} in ${snapshot.project.name}.`);
						}
					});
				}
			}
		}
	}, [hasReceivedSnapshot, isRuntimeDisconnected, projectBoards, startTaskSessionForProject]);
}
