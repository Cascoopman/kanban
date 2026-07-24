import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";

import { notifyError, showAppToast } from "@/components/app-toaster";
import { useTaskTitleDraft } from "@/hooks/use-task-title-draft";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { addTaskToColumnWithResult, findCardSelection, type TaskDraft } from "@/state/board-state";
import type { BoardCard, BoardData } from "@/types";

export function useTaskBranching({
	board,
	setBoard,
	currentProjectId,
	onStartTask,
}: {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	currentProjectId: string | null;
	onStartTask?: (taskId: string) => void;
}) {
	const [sourceTask, setSourceTask] = useState<BoardCard | null>(null);
	const [prompt, setPrompt] = useState("");
	const { title, explicitTitle, onTitleChange, resetTitle } = useTaskTitleDraft(prompt);
	const [isPending, setIsPending] = useState(false);
	const [pendingStartTaskId, setPendingStartTaskId] = useState<string | null>(null);

	useEffect(() => {
		setSourceTask(null);
		setPrompt("");
		resetTitle();
		setIsPending(false);
		setPendingStartTaskId(null);
	}, [currentProjectId, resetTitle]);

	useEffect(() => {
		if (!pendingStartTaskId || !onStartTask) {
			return;
		}
		const selection = findCardSelection(board, pendingStartTaskId);
		if (selection?.column.id !== "backlog") {
			return;
		}
		onStartTask(pendingStartTaskId);
		setPendingStartTaskId(null);
	}, [board, onStartTask, pendingStartTaskId]);

	const handleOpenBranchTask = useCallback(
		(task: BoardCard) => {
			setSourceTask(task);
			setPrompt("");
			resetTitle();
		},
		[resetTitle],
	);

	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				setSourceTask(null);
				setPrompt("");
				resetTitle();
			}
		},
		[resetTitle],
	);

	const handleCreateBranch = useCallback(
		async (options: { start?: boolean } = {}) => {
			const normalizedPrompt = prompt.trim();
			if (!sourceTask || !currentProjectId || !normalizedPrompt || isPending) {
				return;
			}
			const draft: TaskDraft = {
				title: explicitTitle,
				prompt: normalizedPrompt,
				startInPlanMode: sourceTask.startInPlanMode,
				autoReviewEnabled: sourceTask.autoReviewEnabled,
				autoReviewMode: sourceTask.autoReviewMode,
				agentId: sourceTask.agentId,
				clineSettings: sourceTask.clineSettings,
				branchedFromTaskId: sourceTask.id,
				baseRef: sourceTask.baseRef,
			};
			const created = addTaskToColumnWithResult(board, "backlog", draft);
			setIsPending(true);
			try {
				const response = await getRuntimeTrpcClient(currentProjectId).workspace.branchTaskWorkspace.mutate({
					sourceTaskId: sourceTask.id,
					targetTaskId: created.task.id,
					baseRef: sourceTask.baseRef,
				});
				if (!response.ok) {
					notifyError(response.error ?? "Could not branch the task workspace.");
					return;
				}
				setBoard((currentBoard) => {
					if (findCardSelection(currentBoard, created.task.id)) {
						return currentBoard;
					}
					return addTaskToColumnWithResult(currentBoard, "backlog", {
						...draft,
						taskId: created.task.id,
					}).board;
				});
				if (options.start && onStartTask) {
					setPendingStartTaskId(created.task.id);
				}
				if (response.warning) {
					showAppToast({ intent: "warning", message: response.warning, timeout: 7000 });
				} else {
					showAppToast({ intent: "success", message: "Task created." });
				}
				setSourceTask(null);
				setPrompt("");
				resetTitle();
			} catch (error) {
				notifyError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsPending(false);
			}
		},
		[board, currentProjectId, explicitTitle, isPending, onStartTask, prompt, resetTitle, setBoard, sourceTask],
	);

	return {
		sourceTask,
		title,
		onTitleChange,
		prompt,
		setPrompt,
		isPending,
		handleOpenBranchTask,
		handleOpenChange,
		handleCreateBranch,
	};
}
