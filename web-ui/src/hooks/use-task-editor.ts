import { deriveTaskTitleFromPrompt } from "@runtime-task-title";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { RuntimeAgentId } from "@/runtime/types";
import { addTaskToColumnWithResult, updateTaskTitle } from "@/state/board-state";
import { toTelemetrySelectedAgentId, trackTaskCreated } from "@/telemetry/events";
import type { BoardData, TaskImage } from "@/types";

interface UseTaskEditorInput {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	currentProjectId: string | null;
	createTaskBranchOptions: Array<{ value: string; label: string }>;
	defaultTaskBranchRef: string;
	selectedAgentId: RuntimeAgentId | null;
}

export interface CreatedTask {
	taskId: string;
	prompt: string;
	images: TaskImage[];
}

export interface UseTaskEditorResult {
	isInlineTaskCreateOpen: boolean;
	newTaskPrompt: string;
	setNewTaskPrompt: Dispatch<SetStateAction<string>>;
	newTaskImages: TaskImage[];
	setNewTaskImages: Dispatch<SetStateAction<TaskImage[]>>;
	newTaskBranchRef: string;
	handleOpenCreateTask: () => void;
	handleCancelCreateTask: () => void;
	handleSaveTaskTitle: (taskId: string, title: string) => void;
	handleCreateTask: () => CreatedTask | null;
	resetTaskEditorState: () => void;
}

export function useTaskEditor({
	board,
	setBoard,
	currentProjectId,
	createTaskBranchOptions,
	defaultTaskBranchRef,
	selectedAgentId,
}: UseTaskEditorInput): UseTaskEditorResult {
	const [isInlineTaskCreateOpen, setIsInlineTaskCreateOpen] = useState(false);
	const [newTaskPrompt, setNewTaskPrompt] = useState("");
	const [newTaskImages, setNewTaskImages] = useState<TaskImage[]>([]);
	const [newTaskBranchRef, setNewTaskBranchRef] = useState("");
	const [lastCreatedTaskBranchByProjectId, setLastCreatedTaskBranchByProjectId] = useState<Record<string, string>>({});

	const lastCreatedTaskBranchRef = useMemo(() => {
		if (!currentProjectId) {
			return null;
		}
		return lastCreatedTaskBranchByProjectId[currentProjectId] ?? null;
	}, [currentProjectId, lastCreatedTaskBranchByProjectId]);

	const resolvedDefaultTaskBranchRef = useMemo(() => {
		if (
			lastCreatedTaskBranchRef &&
			createTaskBranchOptions.some((option) => option.value === lastCreatedTaskBranchRef)
		) {
			return lastCreatedTaskBranchRef;
		}
		return defaultTaskBranchRef;
	}, [createTaskBranchOptions, defaultTaskBranchRef, lastCreatedTaskBranchRef]);

	useEffect(() => {
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === newTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
	}, [createTaskBranchOptions, newTaskBranchRef, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (isInlineTaskCreateOpen && !newTaskBranchRef) {
			setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
		}
	}, [isInlineTaskCreateOpen, newTaskBranchRef, resolvedDefaultTaskBranchRef]);

	const handleOpenCreateTask = useCallback(() => {
		setNewTaskPrompt("");
		setNewTaskImages([]);
		setIsInlineTaskCreateOpen(true);
	}, []);

	const handleCancelCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setNewTaskPrompt("");
		setNewTaskImages([]);
		setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
	}, [resolvedDefaultTaskBranchRef]);

	const handleSaveTaskTitle = useCallback(
		(taskId: string, title: string) => {
			setBoard((currentBoard) => {
				const updated = updateTaskTitle(currentBoard, taskId, title);
				return updated.updated ? updated.board : currentBoard;
			});
		},
		[setBoard],
	);

	const handleCreateTask = useCallback((): CreatedTask | null => {
		const prompt = newTaskPrompt.trim();
		if (!prompt) {
			return null;
		}
		if (!(newTaskBranchRef || resolvedDefaultTaskBranchRef)) {
			return null;
		}
		const baseRef = newTaskBranchRef || resolvedDefaultTaskBranchRef;
		const title = deriveTaskTitleFromPrompt(prompt) || "New task";
		const created = addTaskToColumnWithResult(board, "in_progress", {
			title,
			startInPlanMode: false,
			agentId: selectedAgentId ?? undefined,
			baseRef,
		});
		setBoard(created.board);
		trackTaskCreated({
			selected_agent_id: toTelemetrySelectedAgentId(selectedAgentId),
			start_in_plan_mode: false,
		});
		if (currentProjectId) {
			setLastCreatedTaskBranchByProjectId((current) => ({
				...current,
				[currentProjectId]: baseRef,
			}));
		}

		const images = newTaskImages.map((image) => ({ ...image }));
		setNewTaskPrompt("");
		setNewTaskImages([]);
		setNewTaskBranchRef(baseRef);
		setIsInlineTaskCreateOpen(false);
		return { taskId: created.task.id, prompt, images };
	}, [
		board,
		currentProjectId,
		newTaskBranchRef,
		newTaskImages,
		newTaskPrompt,
		resolvedDefaultTaskBranchRef,
		selectedAgentId,
		setBoard,
	]);

	const resetTaskEditorState = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setNewTaskPrompt("");
		setNewTaskImages([]);
	}, []);

	return {
		isInlineTaskCreateOpen,
		newTaskPrompt,
		setNewTaskPrompt,
		newTaskImages,
		setNewTaskImages,
		newTaskBranchRef,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleSaveTaskTitle,
		handleCreateTask,
		resetTaskEditorState,
	};
}
