import { useEffect, useRef } from "react";

import { notifyError } from "@/components/app-toaster";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";

export const RESTART_CONTINUATION_PROMPT = "Continue working on the task from where you left off.";

function isRestartableCliSession(summary: RuntimeTaskSessionSummary | undefined): boolean {
	return (
		summary !== undefined &&
		summary.agentId !== null &&
		(summary.state === "idle" || summary.state === "interrupted" || summary.state === "awaiting_review")
	);
}

export function useResumeInterruptedTaskSessions({
	board,
	sessions,
	currentProjectId,
	workspaceHydrationNonce,
	isWorkspaceMetadataPending,
	startTaskSession,
}: {
	board: BoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	currentProjectId: string | null;
	workspaceHydrationNonce: number;
	isWorkspaceMetadataPending: boolean;
	startTaskSession: UseTaskSessionsResult["startTaskSession"];
}): void {
	const handledProjectIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!currentProjectId) {
			handledProjectIdRef.current = null;
			return;
		}
		if (
			workspaceHydrationNonce === 0 ||
			isWorkspaceMetadataPending ||
			handledProjectIdRef.current === currentProjectId
		) {
			return;
		}
		handledProjectIdRef.current = currentProjectId;

		const resumableColumns = board.columns.filter((column) => column.id === "in_progress" || column.id === "review");
		for (const column of resumableColumns) {
			for (const task of column.cards) {
				if (!isRestartableCliSession(sessions[task.id])) {
					continue;
				}
				const shouldContinueWork = column.id === "in_progress";
				void startTaskSession(task, {
					resumeExistingSession: shouldContinueWork ? "running" : "awaiting_review",
					...(shouldContinueWork ? { continuationPrompt: RESTART_CONTINUATION_PROMPT } : {}),
				}).then((result) => {
					if (!result.ok) {
						notifyError(result.message ?? `Could not resume ${task.title}.`);
					}
				});
			}
		}
	}, [board, currentProjectId, isWorkspaceMetadataPending, sessions, startTaskSession, workspaceHydrationNonce]);
}
