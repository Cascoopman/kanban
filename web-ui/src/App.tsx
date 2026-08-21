// Main React composition root for the browser app.
// Keep this file focused on wiring top-level hooks and surfaces together, and
// push runtime-specific orchestration down into hooks and service modules.
import type { DropResult } from "@hello-pangea/dnd";
import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddProjectDialog } from "@/components/add-project-dialog";
import { notifyError, showAppToast } from "@/components/app-toaster";
import { CardDetailView } from "@/components/card-detail-view";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { DebugDialog } from "@/components/debug-dialog";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { GitHistoryView } from "@/components/git-history-view";
import { KanbanBoard } from "@/components/kanban-board";
import { ProjectBoardToolbar } from "@/components/project-board-toolbar";
import { RuntimeSettingsDialog, type RuntimeSettingsSection } from "@/components/runtime-settings-dialog";
import { StartupOnboardingDialog } from "@/components/startup-onboarding-dialog";
import { TaskBranchDialog } from "@/components/task-branch-dialog";
import { TaskCreateDialog } from "@/components/task-create-dialog";
import { TaskInlineCreateCard } from "@/components/task-inline-create-card";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { createInitialBoardData } from "@/data/board-data";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";
import { useAppHotkeys } from "@/hooks/use-app-hotkeys";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useDebugTools } from "@/hooks/use-debug-tools";
import { useDetailTaskNavigation } from "@/hooks/use-detail-task-navigation";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import { useGitActions } from "@/hooks/use-git-actions";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import {
	buildUnifiedProjectBoard,
	createProjectBoardMove,
	type ProjectBoardMove,
	scopeProjectBoardMove,
	useProjectBoards,
} from "@/hooks/use-project-boards";
import { parseRemovedProjectPathFromStreamError, useProjectNavigation } from "@/hooks/use-project-navigation";
import { useProjectUiState } from "@/hooks/use-project-ui-state";
import { useResumeInterruptedTaskSessions } from "@/hooks/use-resume-interrupted-task-sessions";
import { useReviewReadyNotifications } from "@/hooks/use-review-ready-notifications";
import { useShortcutActions } from "@/hooks/use-shortcut-actions";
import { useStartupOnboarding } from "@/hooks/use-startup-onboarding";
import { useTaskBranchOptions } from "@/hooks/use-task-branch-options";
import { useTaskBranching } from "@/hooks/use-task-branching";
import { useTaskEditor } from "@/hooks/use-task-editor";
import { useTaskSessions } from "@/hooks/use-task-sessions";
import { useTaskStartActions } from "@/hooks/use-task-start-actions";
import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import { LayoutCustomizationsProvider } from "@/resize/layout-customizations";
import { ResizableBottomPane } from "@/resize/resizable-bottom-pane";
import { getTaskAgentNavbarHint } from "@/runtime/supported-agents";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useRuntimeProjectConfig } from "@/runtime/use-runtime-project-config";
import { useTerminalConnectionReady } from "@/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { saveWorkspaceState } from "@/runtime/workspace-state-query";
import { findCardSelection } from "@/state/board-state";
import {
	getTaskWorkspaceInfo,
	getTaskWorkspaceSnapshot,
	replaceWorkspaceMetadata,
	resetWorkspaceMetadataStore,
} from "@/stores/workspace-metadata-store";
import { useTerminalThemeColors } from "@/terminal/theme-colors";
import type { BoardData } from "@/types";

export default function App(): ReactElement {
	const terminalThemeColors = useTerminalThemeColors();
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] = useState<RuntimeSettingsSection | null>(null);
	const [visibleProjectIds, setVisibleProjectIds] = useState<Set<string>>(() => new Set());
	const [pendingCreateProjectId, setPendingCreateProjectId] = useState<string | null>(null);
	const [pendingUnifiedBoardMove, setPendingUnifiedBoardMove] = useState<ProjectBoardMove | null>(null);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [isGitHistoryOpen, setIsGitHistoryOpen] = useState(false);
	const [pendingTaskStartAfterEditId, setPendingTaskStartAfterEditId] = useState<string | null>(null);
	const taskEditorResetRef = useRef<() => void>(() => {});
	const lastStreamErrorRef = useRef<string | null>(null);
	const knownProjectIdsRef = useRef<Set<string>>(new Set());
	const handleProjectSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
		setIsGitHistoryOpen(false);
		setPendingTaskStartAfterEditId(null);
		taskEditorResetRef.current();
	}, []);
	const {
		currentProjectId,
		projects,
		projectBoards: streamedProjectBoards,
		workspaceState: streamedWorkspaceState,
		workspaceMetadata,
		latestTaskReadyForReview,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		navigationCurrentProjectId,
		removingProjectId,
		hasNoProjects,
		isProjectSwitching,
		handleSelectProject,
		handleAddProject,
		handleAddProjectSuccess,
		handleRemoveProject,
		isAddProjectDialogOpen,
		setIsAddProjectDialogOpen,
		pendingNativeGitInitPath,
		resetProjectNavigationState,
	} = useProjectNavigation({
		onProjectSwitchStart: handleProjectSwitchStart,
	});
	const activeNotificationWorkspaceId = navigationCurrentProjectId;
	const isDocumentVisible = useDocumentVisibility();
	const isInitialRuntimeLoad =
		!hasReceivedSnapshot && currentProjectId === null && projects.length === 0 && !streamError;
	const isAwaitingWorkspaceSnapshot = currentProjectId !== null && streamedWorkspaceState === null;
	const {
		config: runtimeProjectConfig,
		isLoading: isRuntimeProjectConfigLoading,
		refresh: refreshRuntimeProjectConfig,
	} = useRuntimeProjectConfig(currentProjectId);
	const settingsWorkspaceId = navigationCurrentProjectId ?? currentProjectId;
	const { config: settingsRuntimeProjectConfig, refresh: refreshSettingsRuntimeProjectConfig } =
		useRuntimeProjectConfig(settingsWorkspaceId);
	const {
		isStartupOnboardingDialogOpen,
		handleOpenStartupOnboardingDialog,
		handleCloseStartupOnboardingDialog,
		handleSelectOnboardingAgent,
	} = useStartupOnboarding({
		currentProjectId,
		runtimeProjectConfig,
		isRuntimeProjectConfigLoading,
		refreshRuntimeProjectConfig,
		refreshSettingsRuntimeProjectConfig,
	});
	const {
		debugModeEnabled,
		isDebugDialogOpen,
		isResetAllStatePending,
		handleOpenDebugDialog,
		handleShowStartupOnboardingDialog,
		handleDebugDialogOpenChange,
		handleResetAllState,
	} = useDebugTools({
		runtimeProjectConfig,
		settingsRuntimeProjectConfig,
		onOpenStartupOnboardingDialog: handleOpenStartupOnboardingDialog,
	});
	const {
		markConnectionReady: markTerminalConnectionReady,
		prepareWaitForConnection: prepareWaitForTerminalConnectionReady,
	} = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled = runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
	const shortcuts = runtimeProjectConfig?.shortcuts ?? [];
	const selectedShortcutLabel = useMemo(() => {
		if (shortcuts.length === 0) {
			return null;
		}
		const configured = runtimeProjectConfig?.selectedShortcutLabel ?? null;
		if (configured && shortcuts.some((shortcut) => shortcut.label === configured)) {
			return configured;
		}
		return shortcuts[0]?.label ?? null;
	}, [runtimeProjectConfig?.selectedShortcutLabel, shortcuts]);
	const {
		upsertSession,
		ensureTaskWorkspace,
		startTaskSession,
		stopTaskSession,
		sendTaskSessionInput,
		cleanupTaskWorkspace,
		fetchTaskWorkspaceInfo,
	} = useTaskSessions({
		currentProjectId,
		setSessions,
	});

	const {
		workspacePath,
		workspaceGit,
		workspaceRevision,
		setWorkspaceRevision,
		workspaceHydrationNonce,
		isWorkspaceStateRefreshing,
		isWorkspaceMetadataPending,
		refreshWorkspaceState,
		resetWorkspaceSyncState,
	} = useWorkspaceSync({
		currentProjectId,
		streamedWorkspaceState,
		hasNoProjects,
		hasReceivedSnapshot,
		isDocumentVisible,
		setBoard,
		setSessions,
		setCanPersistWorkspaceState,
	});
	useResumeInterruptedTaskSessions({
		board,
		sessions,
		currentProjectId,
		workspaceHydrationNonce,
		isWorkspaceMetadataPending,
		startTaskSession,
	});
	const { selectedTaskId, selectedCard, setSelectedTaskId, handleProjectTaskSelect, handleBack } =
		useDetailTaskNavigation({
			board,
			currentProjectId,
			isAwaitingWorkspaceSnapshot,
			isInitialRuntimeLoad,
			isProjectSwitching,
			isWorkspaceMetadataPending,
			onSelectProject: handleSelectProject,
			onDetailClosed: () => {
				setIsGitHistoryOpen(false);
			},
		});

	useEffect(() => {
		replaceWorkspaceMetadata(workspaceMetadata);
	}, [workspaceMetadata]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceMetadataStore();
	}, [isProjectSwitching]);

	const { displayedProjects, navigationProjectPath, shouldShowProjectLoadingState, shouldUseNavigationPath } =
		useProjectUiState({
			board,
			canPersistWorkspaceState,
			currentProjectId,
			projects,
			navigationCurrentProjectId,
			selectedTaskId,
			streamError,
			isProjectSwitching,
			isInitialRuntimeLoad,
			isAwaitingWorkspaceSnapshot,
			isWorkspaceMetadataPending,
			hasReceivedSnapshot,
		});
	const projectBoards = useProjectBoards({
		projects: displayedProjects,
		projectBoards: streamedProjectBoards,
		currentProjectId,
		currentBoard: board,
		currentSessions: sessions,
		canUseCurrentBoard: canPersistWorkspaceState,
	});

	useEffect(() => {
		const availableIds = new Set(displayedProjects.map((project) => project.id));
		const knownProjectIds = knownProjectIdsRef.current;
		setVisibleProjectIds((current) => {
			const next = new Set([...current].filter((projectId) => availableIds.has(projectId)));
			const isInitialProjectLoad = knownProjectIds.size === 0;
			for (const projectId of availableIds) {
				if (isInitialProjectLoad || !knownProjectIds.has(projectId)) {
					next.add(projectId);
				}
			}
			return next;
		});
		knownProjectIdsRef.current = availableIds;
	}, [displayedProjects]);

	const unifiedProjectBoard = useMemo(
		() => buildUnifiedProjectBoard(projectBoards.snapshots, visibleProjectIds),
		[projectBoards.snapshots, visibleProjectIds],
	);
	const handleUnifiedCardSelect = useCallback(
		(taskId: string) => {
			const selection = findCardSelection(unifiedProjectBoard.board, taskId);
			const projectId = selection?.card.projectId;
			if (!projectId) {
				return;
			}
			handleProjectTaskSelect(projectId, taskId);
		},
		[handleProjectTaskSelect, unifiedProjectBoard.board],
	);

	useReviewReadyNotifications({
		activeWorkspaceId: activeNotificationWorkspaceId,
		board: unifiedProjectBoard.board,
		isDocumentVisible,
		latestTaskReadyForReview,
		taskSessions: unifiedProjectBoard.sessions,
		readyForReviewNotificationsEnabled,
		workspacePath,
	});

	const { createTaskBranchOptions, defaultTaskBranchRef } = useTaskBranchOptions({ workspaceGit });
	const queueTaskStartAfterEdit = useCallback((taskId: string) => {
		setPendingTaskStartAfterEditId(taskId);
	}, []);

	const {
		isInlineTaskCreateOpen,
		newTaskTitle,
		onNewTaskTitleChange,
		newTaskPrompt,
		setNewTaskPrompt,
		newTaskImages,
		setNewTaskImages,
		newTaskStartInPlanMode,
		setNewTaskStartInPlanMode,
		isNewTaskStartInPlanModeDisabled,
		newTaskBranchRef,
		setNewTaskBranchRef,
		newTaskAgentId,
		setNewTaskAgentId,
		editingTaskId,
		editTaskPrompt,
		setEditTaskPrompt,
		editTaskImages,
		setEditTaskImages,
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
		handleCreateTasks,
		resetTaskEditorState,
	} = useTaskEditor({
		board,
		setBoard,
		currentProjectId,
		createTaskBranchOptions,
		defaultTaskBranchRef,
		selectedAgentId: runtimeProjectConfig?.selectedAgentId ?? null,
		setSelectedTaskId,
		queueTaskStartAfterEdit,
	});
	const handleCreateTaskForProject = useCallback(
		(projectId: string) => {
			if (projectId === currentProjectId && !isProjectSwitching && !isAwaitingWorkspaceSnapshot) {
				handleOpenCreateTask();
				return;
			}
			setPendingCreateProjectId(projectId);
			handleSelectProject(projectId);
		},
		[currentProjectId, handleOpenCreateTask, handleSelectProject, isAwaitingWorkspaceSnapshot, isProjectSwitching],
	);

	useEffect(() => {
		if (
			!pendingCreateProjectId ||
			pendingCreateProjectId !== currentProjectId ||
			isProjectSwitching ||
			isAwaitingWorkspaceSnapshot ||
			isWorkspaceMetadataPending
		) {
			return;
		}
		setPendingCreateProjectId(null);
		handleOpenCreateTask();
	}, [
		currentProjectId,
		handleOpenCreateTask,
		isAwaitingWorkspaceSnapshot,
		isProjectSwitching,
		isWorkspaceMetadataPending,
		pendingCreateProjectId,
	]);

	useEffect(() => {
		taskEditorResetRef.current = resetTaskEditorState;
	}, [resetTaskEditorState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceSyncState();
	}, [isProjectSwitching, resetWorkspaceSyncState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetTaskEditorState();
	}, [isProjectSwitching, resetTaskEditorState]);

	const {
		runningGitAction,
		commitTaskLoadingById,
		openPrTaskLoadingById,
		agentCommitTaskLoadingById,
		agentOpenPrTaskLoadingById,
		gitActionError,
		gitActionErrorTitle,
		clearGitActionError,
		gitHistory,
		handleCommitTask,
		handleOpenPrTask,
		handleAgentCommitTask,
		handleAgentOpenPrTask,
		resetGitActionState,
	} = useGitActions({
		currentProjectId,
		board,
		selectedCard,
		runtimeProjectConfig,
		sendTaskSessionInput,
		fetchTaskWorkspaceInfo,
		isGitHistoryOpen,
		refreshWorkspaceState,
	});
	const agentCommand = runtimeProjectConfig?.effectiveCommand ?? null;
	const {
		homeTerminalTaskId,
		isHomeTerminalOpen,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
		detailTerminalTaskId,
		isDetailTerminalStarting,
		detailTerminalPaneHeight,
		isHomeTerminalExpanded,
		isDetailTerminalExpanded,
		setHomeTerminalPaneHeight,
		setDetailTerminalPaneHeight,
		handleToggleExpandHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleDetailTerminal,
		handleSendAgentCommandToHomeTerminal,
		handleSendAgentCommandToDetailTerminal,
		prepareTerminalForShortcut,
		resetBottomTerminalLayoutCustomizations,
		collapseHomeTerminal,
		collapseDetailTerminal,
		closeHomeTerminal,
		closeDetailTerminal,
		resetTerminalPanelsState,
	} = useTerminalPanels({
		currentProjectId,
		selectedCard,
		workspaceGit,
		agentCommand,
		upsertSession,
		sendTaskSessionInput,
	});
	const homeTerminalSummary = sessions[homeTerminalTaskId] ?? null;
	const { runningShortcutLabel, handleSelectShortcutLabel, handleRunShortcut, handleCreateShortcut } =
		useShortcutActions({
			currentProjectId,
			selectedShortcutLabel: runtimeProjectConfig?.selectedShortcutLabel,
			shortcuts,
			refreshRuntimeProjectConfig,
			prepareTerminalForShortcut,
			prepareWaitForTerminalConnectionReady,
			sendTaskSessionInput,
		});

	const persistWorkspaceStateAsync = useCallback(
		async (input: { workspaceId: string; payload: Parameters<typeof saveWorkspaceState>[1] }) =>
			await saveWorkspaceState(input.workspaceId, input.payload),
		[],
	);
	const handleWorkspaceStateConflict = useCallback(() => {
		showAppToast(
			{
				intent: "warning",
				icon: "warning-sign",
				message: "Workspace changed elsewhere. Synced latest state. Retry your last edit if needed.",
				timeout: 5000,
			},
			"workspace-state-conflict",
		);
	}, []);

	useWorkspacePersistence({
		board,
		sessions,
		currentProjectId,
		workspaceRevision,
		hydrationNonce: workspaceHydrationNonce,
		canPersistWorkspaceState,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		persistWorkspaceState: persistWorkspaceStateAsync,
		refetchWorkspaceState: refreshWorkspaceState,
		onWorkspaceRevisionChange: setWorkspaceRevision,
		onWorkspaceStateConflict: handleWorkspaceStateConflict,
	});

	useEffect(() => {
		if (!streamError) {
			lastStreamErrorRef.current = null;
			return;
		}
		const removedPath = parseRemovedProjectPathFromStreamError(streamError);
		if (removedPath !== null) {
			showAppToast(
				{
					intent: "danger",
					icon: "warning-sign",
					message: removedPath
						? `Project no longer exists and was removed: ${removedPath}`
						: "Project no longer exists and was removed.",
					timeout: 6000,
				},
				`project-removed-${removedPath || "unknown"}`,
			);
			lastStreamErrorRef.current = null;
			return;
		}
		if (isRuntimeDisconnected) {
			lastStreamErrorRef.current = streamError;
			return;
		}
		if (lastStreamErrorRef.current !== streamError) {
			notifyError(streamError, { key: `error:${streamError}` });
		}
		lastStreamErrorRef.current = streamError;
	}, [isRuntimeDisconnected, streamError]);

	useEffect(() => {
		resetTaskEditorState();
		setIsClearTrashDialogOpen(false);
		resetGitActionState();
		resetProjectNavigationState();
		resetTerminalPanelsState();
	}, [
		currentProjectId,
		resetGitActionState,
		resetProjectNavigationState,
		resetTaskEditorState,
		resetTerminalPanelsState,
	]);

	useEffect(() => {
		if (selectedCard) {
			return;
		}
		if (hasNoProjects || !currentProjectId) {
			if (isHomeTerminalOpen) {
				closeHomeTerminal();
			}
			return;
		}
	}, [closeHomeTerminal, currentProjectId, hasNoProjects, isHomeTerminalOpen, selectedCard]);
	const showHomeBottomTerminal = !selectedCard && !hasNoProjects && isHomeTerminalOpen;
	const homeTerminalSubtitle = useMemo(
		() => workspacePath ?? navigationProjectPath ?? null,
		[navigationProjectPath, workspacePath],
	);

	const handleOpenSettings = useCallback((section?: RuntimeSettingsSection) => {
		setSettingsInitialSection(section ?? null);
		setIsSettingsOpen(true);
	}, []);
	const handleToggleGitHistory = useCallback(() => {
		if (hasNoProjects) {
			return;
		}
		setIsGitHistoryOpen((current) => !current);
	}, [hasNoProjects]);
	const handleCloseGitHistory = useCallback(() => {
		setIsGitHistoryOpen(false);
	}, []);

	const {
		handleDragEnd,
		handleStartTask,
		handleStartAllBacklogTasks,
		handleDetailTaskDragEnd,
		handleCardSelect,
		handleMoveToTrash,
		handleMoveReviewCardToTrash,
		handleRestoreTaskFromTrash,
		handleOpenClearTrash,
		handleConfirmClearTrash,
		handleAddReviewComments,
		handleSendReviewComments,
		moveToTrashLoadingById,
		trashTaskCount,
	} = useBoardInteractions({
		board,
		setBoard,
		setSessions,
		selectedCard,
		selectedTaskId,
		currentProjectId,
		setSelectedTaskId,
		setIsClearTrashDialogOpen,
		setIsGitHistoryOpen,
		stopTaskSession,
		cleanupTaskWorkspace,
		ensureTaskWorkspace,
		startTaskSession,
		fetchTaskWorkspaceInfo,
		sendTaskSessionInput,
		readyForReviewNotificationsEnabled,
	});

	const applyUnifiedBoardMove = useCallback(
		(move: ProjectBoardMove) => {
			const scopedResult = scopeProjectBoardMove(board, move);
			if (!scopedResult) {
				return;
			}
			handleDragEnd(scopedResult);
		},
		[board, handleDragEnd],
	);

	const handleUnifiedBoardDragEnd = useCallback(
		(result: DropResult) => {
			const move = createProjectBoardMove(unifiedProjectBoard.board, result);
			if (!move) {
				return;
			}
			if (
				move.projectId === currentProjectId &&
				canPersistWorkspaceState &&
				!isProjectSwitching &&
				!isWorkspaceMetadataPending
			) {
				applyUnifiedBoardMove(move);
				return;
			}
			setPendingUnifiedBoardMove(move);
			handleSelectProject(move.projectId);
		},
		[
			applyUnifiedBoardMove,
			canPersistWorkspaceState,
			currentProjectId,
			handleSelectProject,
			isProjectSwitching,
			isWorkspaceMetadataPending,
			unifiedProjectBoard.board,
		],
	);

	useEffect(() => {
		if (!pendingUnifiedBoardMove) {
			return;
		}
		if (!displayedProjects.some((project) => project.id === pendingUnifiedBoardMove.projectId)) {
			setPendingUnifiedBoardMove(null);
			return;
		}
		if (
			pendingUnifiedBoardMove.projectId !== currentProjectId ||
			!canPersistWorkspaceState ||
			isProjectSwitching ||
			isAwaitingWorkspaceSnapshot ||
			isWorkspaceMetadataPending
		) {
			return;
		}
		const pendingMove = pendingUnifiedBoardMove;
		setPendingUnifiedBoardMove(null);
		applyUnifiedBoardMove(pendingMove);
	}, [
		applyUnifiedBoardMove,
		canPersistWorkspaceState,
		currentProjectId,
		displayedProjects,
		isAwaitingWorkspaceSnapshot,
		isProjectSwitching,
		isWorkspaceMetadataPending,
		pendingUnifiedBoardMove,
	]);

	const {
		handleCreateAndStartTask,
		handleCreateAndStartTasks,
		handleCreateStartAndOpenTask,
		handleStartTaskFromBoard,
		handleStartAllBacklogTasksFromBoard,
	} = useTaskStartActions({
		board,
		handleCreateTask,
		handleCreateTasks,
		handleStartTask,
		handleStartAllBacklogTasks,
		setSelectedTaskId,
	});
	const taskBranching = useTaskBranching({
		board,
		setBoard,
		currentProjectId,
		onStartTask: handleStartTaskFromBoard,
	});

	useAppHotkeys({
		selectedCard,
		isDetailTerminalOpen,
		isHomeTerminalOpen: showHomeBottomTerminal,
		isHomeGitHistoryOpen: !selectedCard && isGitHistoryOpen,
		canUseCreateTaskShortcut: !hasNoProjects && currentProjectId !== null,
		handleToggleDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleExpandHomeTerminal: handleToggleExpandHomeTerminal,
		handleOpenCreateTask,
		handleOpenSettings,
		handleToggleGitHistory,
		handleCloseGitHistory,
		onStartAllTasks: handleStartAllBacklogTasksFromBoard,
	});

	useEffect(() => {
		if (!pendingTaskStartAfterEditId) {
			return;
		}
		const selection = findCardSelection(board, pendingTaskStartAfterEditId);
		if (!selection || selection.column.id !== "backlog") {
			return;
		}
		handleStartTaskFromBoard(pendingTaskStartAfterEditId);
		setPendingTaskStartAfterEditId(null);
	}, [board, handleStartTaskFromBoard, pendingTaskStartAfterEditId]);

	const detailSession = selectedCard
		? (sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id))
		: null;
	const detailTerminalSummary = detailTerminalTaskId ? (sessions[detailTerminalTaskId] ?? null) : null;
	const detailTerminalSubtitle = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return (
			getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef)?.path ??
			getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ??
			null
		);
	}, [selectedCard]);

	const runtimeHint = useMemo(() => {
		return getTaskAgentNavbarHint(runtimeProjectConfig, {
			shouldUseNavigationPath,
		});
	}, [runtimeProjectConfig, shouldUseNavigationPath]);

	const activeWorkspacePath = selectedCard
		? (getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef)?.path ??
			getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ??
			workspacePath ??
			undefined)
		: shouldUseNavigationPath
			? (navigationProjectPath ?? undefined)
			: (workspacePath ?? undefined);

	const activeWorkspaceHint = useMemo(() => {
		if (!selectedCard) {
			return undefined;
		}
		const activeSelectedTaskWorkspaceInfo = getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef);
		if (!activeSelectedTaskWorkspaceInfo) {
			return undefined;
		}
		if (!activeSelectedTaskWorkspaceInfo.exists) {
			return selectedCard.column.id === "trash" ? "Task worktree deleted" : "Task worktree not created yet";
		}
		return undefined;
	}, [selectedCard]);

	const navbarWorkspacePath = selectedCard ? activeWorkspacePath : undefined;
	const navbarWorkspaceHint = selectedCard ? activeWorkspaceHint : undefined;
	const navbarRuntimeHint = selectedCard ? runtimeHint : undefined;
	const shouldHideProjectDependentTopBarActions =
		!selectedCard || isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending;

	const {
		openTargetOptions,
		selectedOpenTargetId,
		onSelectOpenTarget,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	} = useOpenWorkspace({
		currentProjectId,
		workspacePath: activeWorkspacePath,
	});
	const handleCreateDialogOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				handleCancelCreateTask();
			}
		},
		[handleCancelCreateTask],
	);

	const inlineTaskEditor = editingTaskId ? (
		<TaskInlineCreateCard
			prompt={editTaskPrompt}
			onPromptChange={setEditTaskPrompt}
			images={editTaskImages}
			onImagesChange={setEditTaskImages}
			onCreate={handleSaveEditedTask}
			onCreateAndStart={handleSaveAndStartEditedTask}
			onCancel={handleCancelEditTask}
			startInPlanMode={editTaskStartInPlanMode}
			onStartInPlanModeChange={setEditTaskStartInPlanMode}
			startInPlanModeDisabled={isEditTaskStartInPlanModeDisabled}
			workspaceId={currentProjectId}
			branchRef={editTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setEditTaskBranchRef}
			agentId={editTaskAgentId}
			onAgentIdChange={setEditTaskAgentId}
			defaultAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
			mode="edit"
			idPrefix={`inline-edit-task-${editingTaskId}`}
		/>
	) : undefined;

	if (isRuntimeDisconnected) {
		return <RuntimeDisconnectedFallback />;
	}
	return (
		<LayoutCustomizationsProvider onResetBottomTerminalLayoutCustomizations={resetBottomTerminalLayoutCustomizations}>
			<div className="flex h-[100svh] min-w-0 overflow-hidden">
				<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
					<TopBar
						onBack={selectedCard ? handleBack : undefined}
						workspacePath={navbarWorkspacePath}
						isWorkspacePathLoading={selectedCard ? shouldShowProjectLoadingState : false}
						workspaceHint={navbarWorkspaceHint}
						runtimeHint={navbarRuntimeHint}
						selectedTaskId={selectedCard?.card.id ?? null}
						selectedTaskBaseRef={selectedCard?.card.baseRef ?? null}
						showHomeGitSummary={false}
						runningGitAction={selectedCard ? runningGitAction : null}
						onToggleTerminal={selectedCard ? handleToggleDetailTerminal : undefined}
						isTerminalOpen={selectedCard ? isDetailTerminalOpen : false}
						isTerminalLoading={selectedCard ? isDetailTerminalStarting : false}
						onOpenSettings={handleOpenSettings}
						showDebugButton={debugModeEnabled}
						onOpenDebugDialog={debugModeEnabled ? handleOpenDebugDialog : undefined}
						shortcuts={shortcuts}
						selectedShortcutLabel={selectedShortcutLabel}
						onSelectShortcutLabel={handleSelectShortcutLabel}
						runningShortcutLabel={runningShortcutLabel}
						onRunShortcut={handleRunShortcut}
						onCreateFirstShortcut={currentProjectId ? handleCreateShortcut : undefined}
						openTargetOptions={openTargetOptions}
						selectedOpenTargetId={selectedOpenTargetId}
						onSelectOpenTarget={onSelectOpenTarget}
						onOpenWorkspace={onOpenWorkspace}
						canOpenWorkspace={canOpenWorkspace}
						isOpeningWorkspace={isOpeningWorkspace}
						onToggleGitHistory={selectedCard ? handleToggleGitHistory : undefined}
						isGitHistoryOpen={isGitHistoryOpen}
						hideProjectDependentActions={shouldHideProjectDependentTopBarActions}
					/>
					<div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
						<div
							className="kb-home-layout"
							aria-hidden={selectedCard ? true : undefined}
							style={selectedCard ? { visibility: "hidden" } : undefined}
						>
							{projectBoards.isLoading && projectBoards.snapshots.length === 0 ? (
								<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
									<Spinner size={30} />
								</div>
							) : hasNoProjects ? (
								<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0 p-6">
									<div className="flex flex-col items-center justify-center gap-3 text-text-tertiary">
										<FolderOpen size={48} strokeWidth={1} />
										<h3 className="text-sm font-semibold text-text-primary">No projects yet</h3>
										<p className="text-[13px] text-text-secondary">
											Add a git repository to start using Kanban.
										</p>
										<Button
											variant="primary"
											onClick={() => {
												void handleAddProject();
											}}
										>
											Add Project
										</Button>
									</div>
								</div>
							) : (
								<div className="flex flex-1 flex-col min-h-0 min-w-0">
									<ProjectBoardToolbar
										projects={displayedProjects}
										visibleProjectIds={visibleProjectIds}
										onVisibleProjectIdsChange={setVisibleProjectIds}
										onAddProject={() => {
											void handleAddProject();
										}}
										onRemoveProject={handleRemoveProject}
										onCreateTask={handleCreateTaskForProject}
										removingProjectId={removingProjectId}
									/>
									<div className="flex flex-1 min-h-0 min-w-0">
										<KanbanBoard
											data={unifiedProjectBoard.board}
											taskSessions={unifiedProjectBoard.sessions}
											onCardSelect={handleUnifiedCardSelect}
											dependencies={unifiedProjectBoard.board.dependencies}
											hideCardActions
											onDragEnd={handleUnifiedBoardDragEnd}
										/>
									</div>
									{showHomeBottomTerminal ? (
										<ResizableBottomPane
											minHeight={200}
											initialHeight={homeTerminalPaneHeight}
											onHeightChange={setHomeTerminalPaneHeight}
											onCollapse={collapseHomeTerminal}
											isExpanded={isHomeTerminalExpanded}
										>
											<div
												style={{
													display: "flex",
													flex: "1 1 0",
													minWidth: 0,
													paddingLeft: 12,
													paddingRight: 12,
												}}
											>
												<AgentTerminalPanel
													key={`home-shell-${homeTerminalTaskId}`}
													taskId={homeTerminalTaskId}
													workspaceId={currentProjectId}
													summary={homeTerminalSummary}
													onSummary={upsertSession}
													showSessionToolbar={false}
													autoFocus
													onClose={closeHomeTerminal}
													minimalHeaderTitle="Terminal"
													minimalHeaderSubtitle={homeTerminalSubtitle}
													panelBackgroundColor="var(--color-surface-1)"
													terminalBackgroundColor={terminalThemeColors.surfaceRaised}
													cursorColor={terminalThemeColors.textPrimary}
													onConnectionReady={markTerminalConnectionReady}
													agentCommand={agentCommand}
													onSendAgentCommand={handleSendAgentCommandToHomeTerminal}
													isExpanded={isHomeTerminalExpanded}
													onToggleExpand={handleToggleExpandHomeTerminal}
												/>
											</div>
										</ResizableBottomPane>
									) : null}
								</div>
							)}
						</div>
						{selectedCard && detailSession ? (
							<div className="absolute inset-0 flex min-h-0 min-w-0">
								<CardDetailView
									selection={selectedCard}
									currentProjectId={currentProjectId}
									workspacePath={workspacePath}
									sessionSummary={detailSession}
									taskSessions={sessions}
									onSessionSummary={upsertSession}
									onCardSelect={handleCardSelect}
									onTaskDragEnd={handleDetailTaskDragEnd}
									onCreateTask={handleOpenCreateTask}
									onStartTask={handleStartTaskFromBoard}
									onBranchTask={taskBranching.handleOpenBranchTask}
									onStartAllTasks={handleStartAllBacklogTasksFromBoard}
									onClearTrash={handleOpenClearTrash}
									editingTaskId={editingTaskId}
									inlineTaskEditor={inlineTaskEditor}
									onEditTask={(task) => {
										handleOpenEditTask(task, { preserveDetailSelection: true });
									}}
									onSaveTaskTitle={handleSaveTaskTitle}
									onCommitTask={handleCommitTask}
									onOpenPrTask={handleOpenPrTask}
									onAgentCommitTask={handleAgentCommitTask}
									onAgentOpenPrTask={handleAgentOpenPrTask}
									commitTaskLoadingById={commitTaskLoadingById}
									openPrTaskLoadingById={openPrTaskLoadingById}
									agentCommitTaskLoadingById={agentCommitTaskLoadingById}
									agentOpenPrTaskLoadingById={agentOpenPrTaskLoadingById}
									moveToTrashLoadingById={moveToTrashLoadingById}
									onMoveReviewCardToTrash={handleMoveReviewCardToTrash}
									onRestoreTaskFromTrash={handleRestoreTaskFromTrash}
									onAddReviewComments={(taskId: string, text: string) => {
										void handleAddReviewComments(taskId, text);
									}}
									onSendReviewComments={(taskId: string, text: string) => {
										void handleSendReviewComments(taskId, text);
									}}
									onMoveToTrash={handleMoveToTrash}
									isMoveToTrashLoading={moveToTrashLoadingById[selectedCard.card.id] ?? false}
									gitHistoryPanel={
										isGitHistoryOpen ? (
											<GitHistoryView workspaceId={currentProjectId} gitHistory={gitHistory} />
										) : undefined
									}
									onCloseGitHistory={handleCloseGitHistory}
									bottomTerminalOpen={isDetailTerminalOpen}
									bottomTerminalTaskId={detailTerminalTaskId}
									bottomTerminalSummary={detailTerminalSummary}
									bottomTerminalSubtitle={detailTerminalSubtitle}
									onBottomTerminalClose={closeDetailTerminal}
									onBottomTerminalCollapse={collapseDetailTerminal}
									bottomTerminalPaneHeight={detailTerminalPaneHeight}
									onBottomTerminalPaneHeightChange={setDetailTerminalPaneHeight}
									onBottomTerminalConnectionReady={markTerminalConnectionReady}
									bottomTerminalAgentCommand={agentCommand}
									onBottomTerminalSendAgentCommand={handleSendAgentCommandToDetailTerminal}
									isBottomTerminalExpanded={isDetailTerminalExpanded}
									onBottomTerminalToggleExpand={handleToggleExpandDetailTerminal}
									isDocumentVisible={isDocumentVisible}
								/>
							</div>
						) : null}
					</div>
				</div>
				<RuntimeSettingsDialog
					open={isSettingsOpen}
					workspaceId={settingsWorkspaceId}
					initialConfig={settingsRuntimeProjectConfig}
					initialSection={settingsInitialSection}
					onOpenChange={(nextOpen) => {
						setIsSettingsOpen(nextOpen);
						if (!nextOpen) {
							setSettingsInitialSection(null);
						}
					}}
					onSaved={() => {
						refreshRuntimeProjectConfig();
						refreshSettingsRuntimeProjectConfig();
					}}
				/>
				<DebugDialog
					open={isDebugDialogOpen}
					onOpenChange={handleDebugDialogOpenChange}
					isResetAllStatePending={isResetAllStatePending}
					onShowStartupOnboardingDialog={handleShowStartupOnboardingDialog}
					onResetAllState={handleResetAllState}
				/>
				<TaskCreateDialog
					open={isInlineTaskCreateOpen}
					onOpenChange={handleCreateDialogOpenChange}
					title={newTaskTitle}
					onTitleChange={onNewTaskTitleChange}
					prompt={newTaskPrompt}
					onPromptChange={setNewTaskPrompt}
					images={newTaskImages}
					onImagesChange={setNewTaskImages}
					onCreate={handleCreateTask}
					onCreateAndStart={handleCreateAndStartTask}
					onCreateStartAndOpen={handleCreateStartAndOpenTask}
					onCreateMultiple={handleCreateTasks}
					onCreateAndStartMultiple={handleCreateAndStartTasks}
					startInPlanMode={newTaskStartInPlanMode}
					onStartInPlanModeChange={setNewTaskStartInPlanMode}
					startInPlanModeDisabled={isNewTaskStartInPlanModeDisabled}
					workspaceId={currentProjectId}
					branchRef={newTaskBranchRef}
					branchOptions={createTaskBranchOptions}
					onBranchRefChange={setNewTaskBranchRef}
					agentId={newTaskAgentId}
					onAgentIdChange={setNewTaskAgentId}
					defaultAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
				/>
				<TaskBranchDialog
					open={taskBranching.sourceTask !== null}
					sourceTask={taskBranching.sourceTask}
					title={taskBranching.title}
					onTitleChange={taskBranching.onTitleChange}
					prompt={taskBranching.prompt}
					onPromptChange={taskBranching.setPrompt}
					isPending={taskBranching.isPending}
					onOpenChange={taskBranching.handleOpenChange}
					onCreate={() => void taskBranching.handleCreateBranch()}
					onCreateAndStart={() => void taskBranching.handleCreateBranch({ start: true })}
				/>
				<ClearTrashDialog
					open={isClearTrashDialogOpen}
					taskCount={trashTaskCount}
					onCancel={() => setIsClearTrashDialogOpen(false)}
					onConfirm={handleConfirmClearTrash}
				/>
				<StartupOnboardingDialog
					open={isStartupOnboardingDialogOpen}
					onClose={handleCloseStartupOnboardingDialog}
					selectedAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
					agents={runtimeProjectConfig?.agents ?? []}
					onSelectAgent={handleSelectOnboardingAgent}
				/>

				<AddProjectDialog
					open={isAddProjectDialogOpen}
					onOpenChange={setIsAddProjectDialogOpen}
					onProjectAdded={handleAddProjectSuccess}
					currentProjectId={currentProjectId}
					initialGitInitPath={pendingNativeGitInitPath}
				/>

				<AlertDialog
					open={gitActionError !== null}
					onOpenChange={(open) => {
						if (!open) {
							clearGitActionError();
						}
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{gitActionErrorTitle}</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogBody>
						<p>{gitActionError?.message}</p>
						{gitActionError?.output ? (
							<pre className="max-h-[220px] overflow-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap">
								{gitActionError.output}
							</pre>
						) : null}
					</AlertDialogBody>
					<AlertDialogFooter className="justify-end">
						<AlertDialogAction asChild>
							<Button variant="default" onClick={clearGitActionError}>
								Close
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialog>
			</div>
		</LayoutCustomizationsProvider>
	);
}
