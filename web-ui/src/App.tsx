// Main React composition root for the browser app.
// Keep this file focused on wiring top-level hooks and surfaces together, and
// push runtime-specific orchestration down into hooks and service modules.
import type { DropResult } from "@hello-pangea/dnd";
import { ChevronRight, FolderOpen, Settings } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddProjectDialog } from "@/components/add-project-dialog";
import { notifyError, showAppToast } from "@/components/app-toaster";
import { CardDetailView } from "@/components/card-detail-view";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { KanbanBoard } from "@/components/kanban-board";
import { ProjectBoardToolbar } from "@/components/project-board-toolbar";
import { RuntimeSettingsDialog, type RuntimeSettingsSection } from "@/components/runtime-settings-dialog";
import { StartupOnboardingDialog } from "@/components/startup-onboarding-dialog";
import { TaskBranchDialog } from "@/components/task-branch-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { createInitialBoardData } from "@/data/board-data";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";
import { useAppHotkeys } from "@/hooks/use-app-hotkeys";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useDetailTaskNavigation } from "@/hooks/use-detail-task-navigation";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import {
	buildUnifiedProjectBoard,
	createProjectBoardMove,
	type ProjectBoardMove,
	scopeProjectBoardMove,
	useProjectBoards,
} from "@/hooks/use-project-boards";
import { parseRemovedProjectPathFromStreamError, useProjectNavigation } from "@/hooks/use-project-navigation";
import { useProjectUiState } from "@/hooks/use-project-ui-state";
import { useQuickPromptActions } from "@/hooks/use-quick-prompt-actions";
import { useResumeInterruptedTaskSessions } from "@/hooks/use-resume-interrupted-task-sessions";
import { useReviewReadyNotifications } from "@/hooks/use-review-ready-notifications";
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
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useRuntimeProjectConfig } from "@/runtime/use-runtime-project-config";
import { useTerminalConnectionReady } from "@/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { fetchWorkspaceState, saveWorkspaceState } from "@/runtime/workspace-state-query";
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
	const lastStreamErrorRef = useRef<string | null>(null);
	const knownProjectIdsRef = useRef<Set<string>>(new Set());
	const handleProjectSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
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
	const isAwaitingWorkspaceSnapshot = currentProjectId !== null && streamedWorkspaceState === null;
	const activeProjectConfigWorkspaceId = navigationCurrentProjectId ?? currentProjectId;
	const {
		config: runtimeProjectConfig,
		isLoading: isRuntimeProjectConfigLoading,
		refresh: refreshRuntimeProjectConfig,
	} = useRuntimeProjectConfig(activeProjectConfigWorkspaceId);
	const settingsWorkspaceId = activeProjectConfigWorkspaceId;
	const { config: settingsRuntimeProjectConfig, refresh: refreshSettingsRuntimeProjectConfig } =
		useRuntimeProjectConfig(settingsWorkspaceId);
	const { isStartupOnboardingDialogOpen, handleCloseStartupOnboardingDialog, handleSelectOnboardingAgent } =
		useStartupOnboarding({
			currentProjectId,
			runtimeProjectConfig,
			isRuntimeProjectConfigLoading,
			refreshRuntimeProjectConfig,
			refreshSettingsRuntimeProjectConfig,
		});
	const { markConnectionReady: markTerminalConnectionReady } = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled = runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
	const {
		upsertSession,
		ensureTaskWorkspace,
		startTaskSession,
		startTaskSessionForProject,
		stopTaskSession,
		sendTaskSessionInput,
		cleanupTaskWorkspace,
		fetchTaskWorkspaceInfo,
	} = useTaskSessions({
		currentProjectId,
		setSessions,
	});
	const { handleSendQuickPrompt } = useQuickPromptActions({ sendTaskSessionInput });

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
		projectBoards: streamedProjectBoards,
		hasReceivedSnapshot,
		startTaskSessionForProject,
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

	const { displayedProjects, navigationProjectPath } = useProjectUiState({
		board,
		canPersistWorkspaceState,
		currentProjectId,
		projects,
		navigationCurrentProjectId,
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
	const allProjectIds = useMemo(
		() => new Set(projectBoards.snapshots.map((snapshot) => snapshot.project.id)),
		[projectBoards.snapshots],
	);
	const allProjectBoard = useMemo(
		() => buildUnifiedProjectBoard(projectBoards.snapshots, allProjectIds),
		[allProjectIds, projectBoards.snapshots],
	);
	const { selectedTaskId, selectedCard, setSelectedTaskId, handleProjectTaskSelect, handleBack } =
		useDetailTaskNavigation({
			board: allProjectBoard.board,
			currentProjectId,
			isTaskCatalogReady: hasReceivedSnapshot && !projectBoards.isLoading,
			onSelectProject: handleSelectProject,
		});
	const selectedProjectId = selectedCard?.card.projectId ?? null;
	const isSelectedProjectReady =
		selectedProjectId !== null &&
		selectedProjectId === currentProjectId &&
		canPersistWorkspaceState &&
		!isProjectSwitching &&
		!isAwaitingWorkspaceSnapshot &&
		!isWorkspaceMetadataPending;
	const quickPrompts = runtimeProjectConfig?.quickPrompts ?? [];
	const handleAllProjectsCardSelect = useCallback(
		(taskId: string) => {
			const selection = findCardSelection(allProjectBoard.board, taskId);
			const projectId = selection?.card.projectId;
			if (!projectId) {
				return;
			}
			handleProjectTaskSelect(projectId, taskId);
		},
		[allProjectBoard.board, handleProjectTaskSelect],
	);

	useReviewReadyNotifications({
		activeWorkspaceId: activeNotificationWorkspaceId,
		board: allProjectBoard.board,
		isDocumentVisible,
		latestTaskReadyForReview,
		taskSessions: allProjectBoard.sessions,
		readyForReviewNotificationsEnabled,
		workspacePath,
	});

	const { defaultTaskBranchRef } = useTaskBranchOptions({ workspaceGit });
	const { handleSaveTaskTitle, handleCreateTask } = useTaskEditor({
		board,
		setBoard,
		defaultTaskBranchRef,
		selectedAgentId: runtimeProjectConfig?.selectedAgentId ?? null,
	});

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceSyncState();
	}, [isProjectSwitching, resetWorkspaceSyncState]);

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
		resetBottomTerminalLayoutCustomizations,
		collapseHomeTerminal,
		collapseDetailTerminal,
		closeHomeTerminal,
		closeDetailTerminal,
	} = useTerminalPanels({
		currentProjectId: selectedProjectId ?? currentProjectId,
		selectedCard,
		workspaceGit,
		agentCommand,
		upsertSession,
		sendTaskSessionInput,
	});
	const homeTerminalSummary = sessions[homeTerminalTaskId] ?? null;

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
		loadWorkspaceState: fetchWorkspaceState,
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
		setIsClearTrashDialogOpen(false);
		resetProjectNavigationState();
	}, [currentProjectId, resetProjectNavigationState]);

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
	const {
		handleDragEnd,
		handleStartTask,
		handleMoveCardToTrash,
		handleRestoreTaskFromTrash,
		handleConfirmClearTrash,
		moveToTrashLoadingById,
		trashTaskCount,
	} = useBoardInteractions({
		board,
		setBoard,
		setSessions,
		selectedTaskId,
		currentProjectId,
		setSelectedTaskId,
		setIsClearTrashDialogOpen,
		stopTaskSession,
		cleanupTaskWorkspace,
		ensureTaskWorkspace,
		startTaskSession,
		fetchTaskWorkspaceInfo,
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

	const handleProjectBoardMove = useCallback(
		(move: ProjectBoardMove) => {
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
		],
	);
	const handleUnifiedBoardDragEnd = useCallback(
		(result: DropResult) => {
			const move = createProjectBoardMove(unifiedProjectBoard.board, result);
			if (move) {
				handleProjectBoardMove(move);
			}
		},
		[handleProjectBoardMove, unifiedProjectBoard.board],
	);
	const handleAllProjectsBoardDragEnd = useCallback(
		(result: DropResult) => {
			const move = createProjectBoardMove(allProjectBoard.board, result);
			if (move) {
				handleProjectBoardMove(move);
			}
		},
		[allProjectBoard.board, handleProjectBoardMove],
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

	const { handleCreateStartAndOpenTask } = useTaskStartActions({
		board,
		handleCreateTask,
		handleStartTask,
		setSelectedTaskId,
	});
	const handleCreateTaskForProject = useCallback(
		(projectId: string) => {
			if (projectId === currentProjectId && !isProjectSwitching && !isAwaitingWorkspaceSnapshot) {
				handleCreateStartAndOpenTask();
				return;
			}
			setPendingCreateProjectId(projectId);
			handleSelectProject(projectId);
		},
		[
			currentProjectId,
			handleCreateStartAndOpenTask,
			handleSelectProject,
			isAwaitingWorkspaceSnapshot,
			isProjectSwitching,
		],
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
		handleCreateStartAndOpenTask();
	}, [
		currentProjectId,
		handleCreateStartAndOpenTask,
		isAwaitingWorkspaceSnapshot,
		isProjectSwitching,
		isWorkspaceMetadataPending,
		pendingCreateProjectId,
	]);
	const taskBranching = useTaskBranching({
		board,
		setBoard,
		currentProjectId,
		onStartTask: handleStartTask,
	});

	useAppHotkeys({
		selectedCard,
		isDetailTerminalOpen,
		isHomeTerminalOpen: showHomeBottomTerminal,
		canUseCreateTaskShortcut: !hasNoProjects && currentProjectId !== null,
		handleToggleDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleExpandHomeTerminal: handleToggleExpandHomeTerminal,
		handleOpenCreateTask: handleCreateStartAndOpenTask,
		handleOpenSettings,
	});

	const detailSession = selectedCard
		? (allProjectBoard.sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id))
		: null;
	const detailTerminalSummary = detailTerminalTaskId ? (allProjectBoard.sessions[detailTerminalTaskId] ?? null) : null;
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

	if (isRuntimeDisconnected) {
		return <RuntimeDisconnectedFallback />;
	}
	return (
		<LayoutCustomizationsProvider onResetBottomTerminalLayoutCustomizations={resetBottomTerminalLayoutCustomizations}>
			<div className="flex h-[100svh] min-w-0 overflow-hidden">
				<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
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
										<div className="flex gap-2">
											<Button
												variant="primary"
												onClick={() => {
													void handleAddProject();
												}}
											>
												Add Project
											</Button>
											<Button
												variant="default"
												icon={<Settings size={14} />}
												onClick={() => handleOpenSettings()}
											>
												Settings
											</Button>
										</div>
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
										onOpenSettings={() => handleOpenSettings()}
										removingProjectId={removingProjectId}
									/>
									<div className="flex flex-1 min-h-0 min-w-0">
										<KanbanBoard
											data={unifiedProjectBoard.board}
											taskSessions={unifiedProjectBoard.sessions}
											onCardSelect={handleAllProjectsCardSelect}
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
							<div className="absolute inset-0 flex min-h-0 min-w-0 flex-col bg-surface-0">
								<nav
									aria-label="Task breadcrumb"
									className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface-1 px-3"
								>
									<button
										type="button"
										onClick={handleBack}
										className="rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-3 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
									>
										Board
									</button>
									<ChevronRight size={14} className="shrink-0 text-text-tertiary" />
									{selectedCard.card.projectName ? (
										<>
											<span className="max-w-40 truncate text-xs text-text-secondary">
												{selectedCard.card.projectName}
											</span>
											<ChevronRight size={14} className="shrink-0 text-text-tertiary" />
										</>
									) : null}
									<span className="min-w-0 truncate text-xs font-medium text-text-primary">
										{selectedCard.card.title}
									</span>
								</nav>
								<CardDetailView
									selection={selectedCard}
									workspaceId={selectedProjectId}
									workspacePath={selectedCard.card.projectPath ?? workspacePath}
									sessionSummary={detailSession}
									taskSessions={allProjectBoard.sessions}
									onSessionSummary={upsertSession}
									onCardSelect={handleAllProjectsCardSelect}
									onTaskDragEnd={handleAllProjectsBoardDragEnd}
									onCreateTask={handleCreateStartAndOpenTask}
									onBranchTask={taskBranching.handleOpenBranchTask}
									onSaveTaskTitle={handleSaveTaskTitle}
									moveToTrashLoadingById={moveToTrashLoadingById}
									onMoveCardToTrash={handleMoveCardToTrash}
									onRestoreTaskFromTrash={handleRestoreTaskFromTrash}
									quickPrompts={quickPrompts}
									onSendQuickPrompt={handleSendQuickPrompt}
									onEditQuickPrompts={() => handleOpenSettings("quick-prompts")}
									bottomTerminalOpen={isDetailTerminalOpen}
									onToggleBottomTerminal={handleToggleDetailTerminal}
									isBottomTerminalLoading={isDetailTerminalStarting}
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
									canMutateTasks={isSelectedProjectReady}
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
				<TaskBranchDialog
					open={taskBranching.sourceTask !== null}
					sourceTask={taskBranching.sourceTask}
					title={taskBranching.title}
					onTitleChange={taskBranching.onTitleChange}
					isPending={taskBranching.isPending}
					onOpenChange={taskBranching.handleOpenChange}
					onCreate={() => void taskBranching.handleCreateBranch()}
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
			</div>
		</LayoutCustomizationsProvider>
	);
}
