import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TASK_START_IN_PLAN_MODE_STORAGE_KEY } from "@/hooks/app-utils";
import type { RuntimeAgentId } from "@/runtime/types";
import { addTaskToColumnWithResult, findCardSelection, updateTask, updateTaskTitle } from "@/state/board-state";
import { toTelemetrySelectedAgentId, trackTaskCreated } from "@/telemetry/events";
import type { BoardCard, BoardData } from "@/types";
import { useBooleanLocalStorageValue } from "@/utils/react-use";

interface UseTaskEditorInput {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	currentProjectId: string | null;
	createTaskBranchOptions: Array<{ value: string; label: string }>;
	defaultTaskBranchRef: string;
	selectedAgentId: RuntimeAgentId | null;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	queueTaskStartAfterEdit?: (taskId: string) => void;
}

interface OpenEditTaskOptions {
	preserveDetailSelection?: boolean;
}

export interface UseTaskEditorResult {
	isInlineTaskCreateOpen: boolean;
	newTaskTitle: string;
	onNewTaskTitleChange: (value: string) => void;
	newTaskStartInPlanMode: boolean;
	setNewTaskStartInPlanMode: Dispatch<SetStateAction<boolean>>;
	isNewTaskStartInPlanModeDisabled: boolean;
	newTaskBranchRef: string;
	setNewTaskBranchRef: Dispatch<SetStateAction<string>>;
	newTaskAgentId: RuntimeAgentId | undefined;
	setNewTaskAgentId: Dispatch<SetStateAction<RuntimeAgentId | undefined>>;
	editingTaskId: string | null;
	editTaskStartInPlanMode: boolean;
	setEditTaskStartInPlanMode: Dispatch<SetStateAction<boolean>>;
	isEditTaskStartInPlanModeDisabled: boolean;
	editTaskBranchRef: string;
	setEditTaskBranchRef: Dispatch<SetStateAction<string>>;
	editTaskAgentId: RuntimeAgentId | undefined;
	setEditTaskAgentId: Dispatch<SetStateAction<RuntimeAgentId | undefined>>;
	handleOpenCreateTask: () => void;
	handleCancelCreateTask: () => void;
	handleOpenEditTask: (task: BoardCard, options?: OpenEditTaskOptions) => void;
	handleCancelEditTask: () => void;
	handleSaveEditedTask: () => string | null;
	handleSaveAndStartEditedTask: () => void;
	handleSaveTaskTitle: (taskId: string, title: string) => void;
	handleCreateTask: () => string | null;
	resetTaskEditorState: () => void;
}

export function useTaskEditor({
	board,
	setBoard,
	currentProjectId,
	createTaskBranchOptions,
	defaultTaskBranchRef,
	selectedAgentId,
	setSelectedTaskId,
	queueTaskStartAfterEdit,
}: UseTaskEditorInput): UseTaskEditorResult {
	const [isInlineTaskCreateOpen, setIsInlineTaskCreateOpen] = useState(false);
	const [newTaskTitle, setNewTaskTitle] = useState("");
	const [newTaskStartInPlanMode, setNewTaskStartInPlanMode] = useBooleanLocalStorageValue(
		TASK_START_IN_PLAN_MODE_STORAGE_KEY,
		false,
	);
	const isNewTaskStartInPlanModeDisabled = false;
	const [newTaskBranchRef, setNewTaskBranchRef] = useState("");
	const [lastCreatedTaskBranchByProjectId, setLastCreatedTaskBranchByProjectId] = useState<Record<string, string>>({});
	const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
	const [editTaskStartInPlanMode, setEditTaskStartInPlanMode] = useState(false);
	const isEditTaskStartInPlanModeDisabled = false;
	const [editTaskBranchRef, setEditTaskBranchRef] = useState("");

	const [newTaskAgentId, setNewTaskAgentId] = useState<RuntimeAgentId | undefined>(undefined);
	const [editTaskAgentId, setEditTaskAgentId] = useState<RuntimeAgentId | undefined>(undefined);

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
		if (!isInlineTaskCreateOpen) {
			return;
		}
		if (!newTaskBranchRef) {
			setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
		}
	}, [isInlineTaskCreateOpen, newTaskBranchRef, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (!isNewTaskStartInPlanModeDisabled || !newTaskStartInPlanMode) {
			return;
		}
		setNewTaskStartInPlanMode(false);
	}, [isNewTaskStartInPlanModeDisabled, newTaskStartInPlanMode, setNewTaskStartInPlanMode]);

	useEffect(() => {
		if (!isEditTaskStartInPlanModeDisabled || !editTaskStartInPlanMode) {
			return;
		}
		setEditTaskStartInPlanMode(false);
	}, [editTaskStartInPlanMode, isEditTaskStartInPlanModeDisabled]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === editTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setEditTaskBranchRef(resolvedDefaultTaskBranchRef);
	}, [createTaskBranchOptions, editTaskBranchRef, editingTaskId, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		const selection = findCardSelection(board, editingTaskId);
		if (!selection || selection.column.id !== "backlog") {
			setEditingTaskId(null);

			setEditTaskStartInPlanMode(false);
			setEditTaskBranchRef("");
		}
	}, [board, editingTaskId]);

	const handleOpenCreateTask = useCallback(() => {
		setEditingTaskId(null);

		setNewTaskTitle("");
		setNewTaskAgentId(undefined);
		setIsInlineTaskCreateOpen(true);
	}, []);

	const handleCancelCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(false);

		setNewTaskTitle("");
		setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
		setNewTaskAgentId(undefined);
	}, [resolvedDefaultTaskBranchRef]);

	const handleOpenEditTask = useCallback(
		(task: BoardCard, options?: OpenEditTaskOptions) => {
			if (!options?.preserveDetailSelection) {
				setSelectedTaskId(null);
			}
			setIsInlineTaskCreateOpen(false);
			setEditingTaskId(task.id);

			setEditTaskStartInPlanMode(task.startInPlanMode);
			const fallbackBranch = task.baseRef || resolvedDefaultTaskBranchRef;
			setEditTaskBranchRef(fallbackBranch);
			setEditTaskAgentId(task.agentId);
		},
		[resolvedDefaultTaskBranchRef, setSelectedTaskId],
	);

	const handleCancelEditTask = useCallback(() => {
		setEditingTaskId(null);

		setEditTaskStartInPlanMode(false);
		setEditTaskBranchRef("");
	}, []);

	const handleSaveEditedTask = useCallback((): string | null => {
		if (!editingTaskId) {
			return null;
		}
		if (!(editTaskBranchRef || resolvedDefaultTaskBranchRef)) {
			return null;
		}

		const baseRef = editTaskBranchRef || resolvedDefaultTaskBranchRef;
		const savedTaskId = editingTaskId;

		setBoard((currentBoard) => {
			const currentCard = currentBoard.columns.flatMap((c) => c.cards).find((c) => c.id === savedTaskId);
			if (!currentCard) {
				return currentBoard;
			}
			const updated = updateTask(currentBoard, savedTaskId, {
				title: currentCard.title,
				startInPlanMode: editTaskStartInPlanMode,
				agentId: editTaskAgentId,
				baseRef,
			});
			return updated.updated ? updated.board : currentBoard;
		});
		setEditingTaskId(null);

		setEditTaskStartInPlanMode(false);
		setEditTaskBranchRef("");
		setEditTaskAgentId(undefined);
		return savedTaskId;
	}, [
		editTaskAgentId,
		editTaskBranchRef,
		editTaskStartInPlanMode,
		editingTaskId,
		resolvedDefaultTaskBranchRef,
		setBoard,
	]);

	const handleSaveAndStartEditedTask = useCallback(() => {
		const taskId = handleSaveEditedTask();
		if (!taskId) {
			return;
		}
		queueTaskStartAfterEdit?.(taskId);
	}, [handleSaveEditedTask, queueTaskStartAfterEdit]);

	const handleSaveTaskTitle = useCallback(
		(taskId: string, title: string) => {
			setBoard((currentBoard) => {
				const updated = updateTaskTitle(currentBoard, taskId, title);
				return updated.updated ? updated.board : currentBoard;
			});
		},
		[setBoard],
	);

	const handleCreateTask = useCallback((): string | null => {
		const title = newTaskTitle.trim();
		if (!title) {
			return null;
		}
		if (!(newTaskBranchRef || resolvedDefaultTaskBranchRef)) {
			return null;
		}
		const baseRef = newTaskBranchRef || resolvedDefaultTaskBranchRef;
		const created = addTaskToColumnWithResult(board, "backlog", {
			title,
			startInPlanMode: newTaskStartInPlanMode,
			agentId: newTaskAgentId,
			baseRef,
		});
		setBoard(created.board);
		trackTaskCreated({
			selected_agent_id: toTelemetrySelectedAgentId(newTaskAgentId ?? selectedAgentId),
			start_in_plan_mode: newTaskStartInPlanMode,
		});
		if (currentProjectId) {
			setLastCreatedTaskBranchByProjectId((current) => ({
				...current,
				[currentProjectId]: baseRef,
			}));
		}

		setNewTaskTitle("");
		setNewTaskBranchRef(baseRef);
		setNewTaskAgentId(undefined);
		setIsInlineTaskCreateOpen(false);
		return created.task.id;
	}, [
		board,
		currentProjectId,
		newTaskAgentId,
		newTaskBranchRef,
		newTaskStartInPlanMode,
		newTaskTitle,
		resolvedDefaultTaskBranchRef,
		selectedAgentId,
		setBoard,
		setNewTaskAgentId,
	]);

	const resetTaskEditorState = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setEditingTaskId(null);

		setNewTaskTitle("");

		setEditTaskStartInPlanMode(false);
		setEditTaskBranchRef("");
		setEditTaskAgentId(undefined);
		setNewTaskAgentId(undefined);
	}, []);

	return {
		isInlineTaskCreateOpen,
		newTaskTitle,
		onNewTaskTitleChange: setNewTaskTitle,
		newTaskStartInPlanMode,
		setNewTaskStartInPlanMode,
		isNewTaskStartInPlanModeDisabled,
		newTaskBranchRef,
		setNewTaskBranchRef,
		newTaskAgentId,
		setNewTaskAgentId,
		editingTaskId,
		editTaskStartInPlanMode,
		setEditTaskStartInPlanMode,
		isEditTaskStartInPlanModeDisabled,
		editTaskBranchRef,
		setEditTaskBranchRef,
		editTaskAgentId,
		setEditTaskAgentId,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleOpenEditTask,
		handleCancelEditTask,
		handleSaveEditedTask,
		handleSaveAndStartEditedTask,
		handleSaveTaskTitle,
		handleCreateTask,
		resetTaskEditorState,
	};
}
