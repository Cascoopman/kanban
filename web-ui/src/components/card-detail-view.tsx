import type { DropResult } from "@hello-pangea/dnd";
import { Code2, Maximize2, MessageSquare, Minimize2, PanelRightClose } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { ColumnContextPanel } from "@/components/detail-panels/column-context-panel";
import { VscodeInlinePanel } from "@/components/detail-panels/vscode-inline-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { ResizableBottomPane } from "@/resize/resizable-bottom-pane";
import { ResizeHandle } from "@/resize/resize-handle";
import { useCardDetailLayout } from "@/resize/use-card-detail-layout";
import { useResizeDrag } from "@/resize/use-resize-drag";
import type { RuntimeQuickPrompt, RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTerminalThemeColors } from "@/terminal/theme-colors";
import { type BoardCard, type BoardData, type CardSelection, isReviewLikeColumnId } from "@/types";
import { useWindowEvent } from "@/utils/react-use";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function isEventInsideDialog(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("[role='dialog']") !== null;
}

function useResizeHandler(
	containerRef: React.RefObject<HTMLDivElement | null>,
	ratio: number,
	setRatio: (ratio: number) => void,
	startDrag: ReturnType<typeof useResizeDrag>["startDrag"],
): (event: ReactMouseEvent<HTMLDivElement>) => void {
	return useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const container = containerRef.current;
			if (!container) {
				return;
			}
			const containerWidth = Math.max(container.offsetWidth, 1);
			const startX = event.clientX;
			const applyDelta = (pointerX: number) => setRatio(ratio + (pointerX - startX) / containerWidth);
			startDrag(event, { axis: "x", cursor: "ew-resize", onMove: applyDelta, onEnd: applyDelta });
		},
		[containerRef, ratio, setRatio, startDrag],
	);
}

function BottomTerminalSection({
	taskId,
	workspaceId,
	summary,
	onSummary,
	onClose,
	subtitle,
	terminalThemeColors,
	onConnectionReady,
	agentCommand,
	onSendAgentCommand,
	paneHeight,
	onPaneHeightChange,
	onCollapse,
	isExpanded,
	onToggleExpand,
}: {
	taskId: string;
	workspaceId: string | null;
	summary: RuntimeTaskSessionSummary | null;
	onSummary: (summary: RuntimeTaskSessionSummary) => void;
	onClose: () => void;
	subtitle?: string | null;
	terminalThemeColors: { surfaceRaised: string; textPrimary: string };
	onConnectionReady?: (taskId: string) => void;
	agentCommand?: string | null;
	onSendAgentCommand?: () => void;
	paneHeight?: number;
	onPaneHeightChange?: (height: number) => void;
	onCollapse?: () => void;
	isExpanded?: boolean;
	onToggleExpand?: () => void;
}): React.ReactElement {
	return (
		<ResizableBottomPane
			minHeight={200}
			initialHeight={paneHeight}
			onHeightChange={onPaneHeightChange}
			onCollapse={onCollapse}
			isExpanded={isExpanded}
		>
			<div className="flex min-w-0 flex-1 px-3">
				<AgentTerminalPanel
					taskId={taskId}
					workspaceId={workspaceId}
					summary={summary}
					onSummary={onSummary}
					showSessionToolbar={false}
					autoFocus
					onClose={onClose}
					minimalHeaderTitle="Terminal"
					minimalHeaderSubtitle={subtitle}
					panelBackgroundColor="var(--color-surface-1)"
					terminalBackgroundColor={terminalThemeColors.surfaceRaised}
					cursorColor={terminalThemeColors.textPrimary}
					onConnectionReady={onConnectionReady}
					agentCommand={agentCommand}
					onSendAgentCommand={onSendAgentCommand}
					isExpanded={isExpanded}
					onToggleExpand={onToggleExpand}
				/>
			</div>
		</ResizableBottomPane>
	);
}

function VscodeToolbar({
	isExpanded,
	onToggleExpand,
	onCollapse,
	hideExpand,
}: {
	isExpanded: boolean;
	onToggleExpand: () => void;
	onCollapse?: () => void;
	hideExpand?: boolean;
}): React.ReactElement {
	return (
		<div
			className={cn(
				"flex h-8 shrink-0 items-center gap-2 border-b border-divider bg-surface-1 px-2",
				isExpanded && "pl-11",
			)}
		>
			<Code2 size={14} className="text-accent" />
			<span className="text-xs font-medium text-text-primary">VS Code</span>
			<div className="ml-auto flex items-center gap-1">
				{onCollapse ? (
					<Button
						variant="ghost"
						size="sm"
						icon={<PanelRightClose size={14} />}
						onClick={onCollapse}
						className="h-6"
						aria-label="Collapse VS Code"
					/>
				) : null}
				{!hideExpand ? (
					<Button
						variant="ghost"
						size="sm"
						icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
						onClick={onToggleExpand}
						className="h-6"
						aria-label={isExpanded ? "Exit expanded VS Code view" : "Expand VS Code view"}
					/>
				) : null}
			</div>
		</div>
	);
}

type MobileTab = "chat" | "code";

const VSCODE_PRELOAD_FALLBACK_MS = 5_000;

function scheduleIdleWork(callback: () => void): () => void {
	if (typeof window.requestIdleCallback === "function") {
		const idleCallbackId = window.requestIdleCallback(callback, { timeout: VSCODE_PRELOAD_FALLBACK_MS });
		return () => window.cancelIdleCallback(idleCallbackId);
	}

	const timeoutId = window.setTimeout(callback, 0);
	return () => window.clearTimeout(timeoutId);
}

function MobileDetailTabBar({
	activeTab,
	onTabChange,
}: {
	activeTab: MobileTab;
	onTabChange: (tab: MobileTab) => void;
}): React.ReactElement {
	const tabs: { id: MobileTab; label: string; icon: React.ReactElement }[] = [
		{ id: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
		{ id: "code", label: "VS Code", icon: <Code2 size={14} /> },
	];
	return (
		<div className="flex min-h-9 items-center border-b border-border">
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					className={cn(
						"relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors",
						activeTab === tab.id ? "text-accent" : "text-text-secondary",
					)}
					onClick={() => onTabChange(tab.id)}
				>
					{tab.icon}
					{tab.label}
					{activeTab === tab.id ? <span className="absolute right-0 bottom-0 left-0 h-0.5 bg-accent" /> : null}
				</button>
			))}
		</div>
	);
}

export function CardDetailView({
	selection,
	workspaceId,
	sessionSummary,
	taskSessions,
	onSessionSummary,
	onCardSelect,
	onTaskDragEnd,
	onCreateTask,
	onBranchTask,
	onClearTrash,
	onMoveCardToTrash,
	onRestoreTaskFromTrash,
	moveToTrashLoadingById,
	quickPrompts = [],
	onSendQuickPrompt,
	onEditQuickPrompts,
	bottomTerminalOpen,
	onToggleBottomTerminal,
	isBottomTerminalLoading,
	bottomTerminalTaskId,
	bottomTerminalSummary,
	bottomTerminalSubtitle,
	onBottomTerminalClose,
	onBottomTerminalCollapse,
	bottomTerminalPaneHeight,
	onBottomTerminalPaneHeightChange,
	onBottomTerminalConnectionReady,
	bottomTerminalAgentCommand,
	onBottomTerminalSendAgentCommand,
	isBottomTerminalExpanded,
	onBottomTerminalToggleExpand,
	canMutateTasks = true,
	dependencyBoard,
	onAddDependency,
	onRemoveDependency,
	onSelectDependencyTask,
}: {
	selection: CardSelection;
	workspaceId: string | null;
	sessionSummary: RuntimeTaskSessionSummary | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onCardSelect: (taskId: string) => void;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	onBranchTask?: (task: BoardCard) => void;
	onClearTrash?: () => void;
	onMoveCardToTrash?: (taskId: string) => void;
	onRestoreTaskFromTrash?: (taskId: string) => void;
	moveToTrashLoadingById?: Record<string, boolean>;
	quickPrompts?: readonly RuntimeQuickPrompt[];
	onSendQuickPrompt?: (taskId: string, prompt: string) => Promise<void>;
	onEditQuickPrompts?: () => void;
	bottomTerminalOpen: boolean;
	onToggleBottomTerminal: () => void;
	isBottomTerminalLoading?: boolean;
	bottomTerminalTaskId: string | null;
	bottomTerminalSummary: RuntimeTaskSessionSummary | null;
	bottomTerminalSubtitle?: string | null;
	onBottomTerminalClose: () => void;
	onBottomTerminalCollapse?: () => void;
	bottomTerminalPaneHeight?: number;
	onBottomTerminalPaneHeightChange?: (height: number) => void;
	onBottomTerminalConnectionReady?: (taskId: string) => void;
	bottomTerminalAgentCommand?: string | null;
	onBottomTerminalSendAgentCommand?: () => void;
	isBottomTerminalExpanded?: boolean;
	onBottomTerminalToggleExpand?: () => void;
	canMutateTasks?: boolean;
	dependencyBoard: BoardData;
	onAddDependency: (dependsOnTaskId: string) => void;
	onRemoveDependency: (dependencyId: string) => void;
	onSelectDependencyTask: (taskId: string) => void;
}): React.ReactElement {
	const isMobile = useIsMobile();
	const [mobileTabState, setMobileTabState] = useState<{ taskId: string; tab: MobileTab }>(() => ({
		taskId: selection.card.id,
		tab: "chat",
	}));
	const mobileTab = mobileTabState.taskId === selection.card.id ? mobileTabState.tab : "chat";
	const [codePanelState, setCodePanelState] = useState({
		taskId: selection.card.id,
		isCollapsed: true,
		isExpanded: false,
		isMounted: false,
	});
	const [mainTerminalReadyTaskId, setMainTerminalReadyTaskId] = useState<string | null>(null);
	const isCurrentTaskCodeState = codePanelState.taskId === selection.card.id;
	const isCodeCollapsed = !isCurrentTaskCodeState || codePanelState.isCollapsed;
	const isCodeExpanded = isCurrentTaskCodeState && codePanelState.isExpanded;
	const isCodeMounted = isCurrentTaskCodeState && codePanelState.isMounted;
	const mountCodePanel = useCallback(() => {
		setCodePanelState((current) =>
			current.taskId === selection.card.id ? { ...current, isMounted: true } : current,
		);
	}, [selection.card.id]);
	const setMobileTab = useCallback(
		(tab: MobileTab) => {
			setMobileTabState({ taskId: selection.card.id, tab });
			if (tab === "code") mountCodePanel();
		},
		[mountCodePanel, selection.card.id],
	);
	const { taskCardsPanelRatio, setTaskCardsPanelRatio, agentPanelRatio, setAgentPanelRatio } = useCardDetailLayout();
	const { startDrag: startTaskCardsPanelResize } = useResizeDrag();
	const { startDrag: startAgentPanelResize } = useResizeDrag();
	const detailLayoutRef = useRef<HTMLDivElement | null>(null);
	const mainRowRef = useRef<HTMLDivElement | null>(null);
	const handleSeparatorMouseDown = useResizeHandler(
		detailLayoutRef,
		taskCardsPanelRatio,
		setTaskCardsPanelRatio,
		startTaskCardsPanelResize,
	);
	const handleAgentCodeSeparatorMouseDown = useResizeHandler(
		mainRowRef,
		agentPanelRatio,
		setAgentPanelRatio,
		startAgentPanelResize,
	);
	const terminalThemeColors = useTerminalThemeColors();
	const isTaskTerminalEnabled = selection.column.id === "in_progress" || isReviewLikeColumnId(selection.column.id);
	const taskCardsPanelPercent = `${(taskCardsPanelRatio * 100).toFixed(1)}%`;
	const detailContentPanelPercent = `${((1 - taskCardsPanelRatio) * 100).toFixed(1)}%`;
	const agentPanelPercent = `${(agentPanelRatio * 100).toFixed(1)}%`;
	const codePanelPercent = `${((1 - agentPanelRatio) * 100).toFixed(1)}%`;

	const handleSelectAdjacentCard = useCallback(
		(step: number) => {
			const cards = selection.column.cards;
			const currentIndex = cards.findIndex((card) => card.id === selection.card.id);
			const nextCard = currentIndex === -1 ? undefined : cards[(currentIndex + step + cards.length) % cards.length];
			if (nextCard) onCardSelect(nextCard.id);
		},
		[onCardSelect, selection.card.id, selection.column.cards],
	);

	useHotkeys("up,left", () => handleSelectAdjacentCard(-1), {
		ignoreEventWhen: (event) => isTypingTarget(event.target),
		preventDefault: true,
	});
	useHotkeys("down,right", () => handleSelectAdjacentCard(1), {
		ignoreEventWhen: (event) => isTypingTarget(event.target),
		preventDefault: true,
	});
	useWindowEvent(
		"keydown",
		useCallback(
			(event: KeyboardEvent) => {
				if (event.key !== "Escape" || event.defaultPrevented || isEventInsideDialog(event.target)) return;
				if (!isTypingTarget(event.target) && isCodeExpanded) {
					event.preventDefault();
					setCodePanelState({ taskId: selection.card.id, isCollapsed: false, isExpanded: false, isMounted: true });
				}
			},
			[isCodeExpanded, selection.card.id],
		),
	);

	useEffect(() => {
		setCodePanelState({ taskId: selection.card.id, isCollapsed: true, isExpanded: false, isMounted: false });
		setMainTerminalReadyTaskId(null);
		setMobileTabState({ taskId: selection.card.id, tab: "chat" });
	}, [selection.card.id]);

	useEffect(() => {
		if (isCodeMounted) return;

		let cancelIdleWork: (() => void) | undefined;
		const schedulePreload = () => {
			cancelIdleWork = scheduleIdleWork(mountCodePanel);
		};

		if (!isTaskTerminalEnabled || mainTerminalReadyTaskId === selection.card.id) {
			schedulePreload();
			return () => cancelIdleWork?.();
		}

		const fallbackId = window.setTimeout(schedulePreload, VSCODE_PRELOAD_FALLBACK_MS);
		return () => {
			window.clearTimeout(fallbackId);
			cancelIdleWork?.();
		};
	}, [isCodeMounted, isTaskTerminalEnabled, mainTerminalReadyTaskId, mountCodePanel, selection.card.id]);

	const handleMainTerminalConnectionReady = useCallback((taskId: string) => {
		setMainTerminalReadyTaskId(taskId);
	}, []);

	const toggleCodeExpanded = useCallback(() => {
		if (!isCodeExpanded && bottomTerminalOpen) onBottomTerminalClose();
		setCodePanelState({
			taskId: selection.card.id,
			isCollapsed: false,
			isExpanded: !isCodeExpanded,
			isMounted: true,
		});
	}, [bottomTerminalOpen, isCodeExpanded, onBottomTerminalClose, selection.card.id]);
	const collapseCode = useCallback(
		() => setCodePanelState({ taskId: selection.card.id, isCollapsed: true, isExpanded: false, isMounted: true }),
		[selection.card.id],
	);
	const expandCode = useCallback(
		() => setCodePanelState({ taskId: selection.card.id, isCollapsed: false, isExpanded: false, isMounted: true }),
		[selection.card.id],
	);
	const handleToggleCode = useCallback(() => {
		if (isMobile) {
			setMobileTab(mobileTab === "code" ? "chat" : "code");
			return;
		}
		if (isCodeCollapsed) {
			expandCode();
			return;
		}
		collapseCode();
	}, [collapseCode, expandCode, isCodeCollapsed, isMobile, mobileTab, setMobileTab]);
	const showBottomTerminal = bottomTerminalOpen && !!bottomTerminalTaskId;
	const vscodePanel = (
		<VscodeInlinePanel taskId={selection.card.id} baseRef={selection.card.baseRef} workspaceId={workspaceId} />
	);
	const agentChatPanel = (
		<AgentTerminalPanel
			taskId={selection.card.id}
			workspaceId={workspaceId}
			terminalEnabled={isTaskTerminalEnabled}
			summary={sessionSummary}
			onSummary={onSessionSummary}
			showSessionToolbar={false}
			autoFocus
			onToggleShell={onToggleBottomTerminal}
			isShellOpen={bottomTerminalOpen}
			isShellLoading={isBottomTerminalLoading}
			onToggleCode={handleToggleCode}
			isCodeOpen={isMobile ? mobileTab === "code" : !isCodeCollapsed}
			quickPrompts={quickPrompts}
			onSendQuickPrompt={
				onSendQuickPrompt ? async (prompt) => await onSendQuickPrompt(selection.card.id, prompt) : undefined
			}
			onEditQuickPrompts={onEditQuickPrompts}
			panelBackgroundColor="var(--color-surface-0)"
			terminalBackgroundColor={terminalThemeColors.surfacePrimary}
			cursorColor={terminalThemeColors.textPrimary}
			taskColumnId={selection.column.id}
			onConnectionReady={handleMainTerminalConnectionReady}
		/>
	);

	if (isMobile) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
				<MobileDetailTabBar activeTab={mobileTab} onTabChange={setMobileTab} />
				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "chat" ? "flex" : "none" }}
						>
							{agentChatPanel}
						</div>
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "code" ? "flex" : "none" }}
						>
							<VscodeToolbar isExpanded={false} onToggleExpand={toggleCodeExpanded} hideExpand />
							{isCodeMounted ? vscodePanel : null}
						</div>
					</div>
					{showBottomTerminal ? (
						<div className="absolute right-0 bottom-0 left-0 z-20">
							<BottomTerminalSection
								taskId={bottomTerminalTaskId}
								workspaceId={workspaceId}
								summary={bottomTerminalSummary}
								onSummary={onSessionSummary}
								onClose={onBottomTerminalClose}
								subtitle={bottomTerminalSubtitle}
								terminalThemeColors={terminalThemeColors}
								onConnectionReady={onBottomTerminalConnectionReady}
								agentCommand={bottomTerminalAgentCommand}
								onSendAgentCommand={onBottomTerminalSendAgentCommand}
								paneHeight={bottomTerminalPaneHeight}
								onPaneHeightChange={onBottomTerminalPaneHeightChange}
								onCollapse={onBottomTerminalCollapse}
								isExpanded={isBottomTerminalExpanded}
								onToggleExpand={onBottomTerminalToggleExpand}
							/>
						</div>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div ref={detailLayoutRef} className="flex min-h-0 flex-1 overflow-hidden bg-surface-0">
			{!isCodeExpanded ? (
				<>
					<div className="flex min-h-0 min-w-0" style={{ width: taskCardsPanelPercent }}>
						<ColumnContextPanel
							selection={selection}
							onCardSelect={onCardSelect}
							taskSessions={taskSessions}
							onTaskDragEnd={onTaskDragEnd}
							onCreateTask={canMutateTasks ? onCreateTask : undefined}
							onBranchTask={canMutateTasks ? onBranchTask : undefined}
							onClearTrash={canMutateTasks ? onClearTrash : undefined}
							onMoveToTrashTask={canMutateTasks ? onMoveCardToTrash : undefined}
							onRestoreFromTrashTask={canMutateTasks ? onRestoreTaskFromTrash : undefined}
							moveToTrashLoadingById={moveToTrashLoadingById}
							panelWidth="100%"
							mutableProjectId={canMutateTasks ? workspaceId : null}
							dependencyBoard={dependencyBoard}
							onAddDependency={onAddDependency}
							onRemoveDependency={onRemoveDependency}
							onSelectDependencyTask={onSelectDependencyTask}
						/>
					</div>
					<ResizeHandle
						orientation="vertical"
						ariaLabel="Resize task cards and detail panels"
						onMouseDown={handleSeparatorMouseDown}
						className="z-10"
					/>
				</>
			) : null}
			<div
				className="flex min-h-0 min-w-0 flex-col overflow-hidden"
				style={{ width: isCodeExpanded ? "100%" : detailContentPanelPercent }}
			>
				<>
					<div ref={mainRowRef} className="relative flex min-h-0 flex-1 overflow-hidden">
						<div
							className="min-h-0 min-w-0"
							style={{
								display: isCodeExpanded ? "none" : "flex",
								width: isCodeCollapsed ? "100%" : agentPanelPercent,
							}}
						>
							{agentChatPanel}
						</div>
						{!isCodeExpanded && !isCodeCollapsed ? (
							<ResizeHandle
								orientation="vertical"
								ariaLabel="Resize agent and VS Code panels"
								onMouseDown={handleAgentCodeSeparatorMouseDown}
								className="z-10"
							/>
						) : null}
						{isCodeMounted ? (
							<div
								aria-hidden={isCodeCollapsed || undefined}
								className={cn(
									"flex min-h-0 min-w-0 flex-col",
									isCodeCollapsed && "pointer-events-none invisible absolute inset-y-0 right-0",
								)}
								style={{ width: isCodeExpanded ? "100%" : codePanelPercent }}
							>
								<VscodeToolbar
									isExpanded={isCodeExpanded}
									onToggleExpand={toggleCodeExpanded}
									onCollapse={collapseCode}
								/>
								{vscodePanel}
							</div>
						) : null}
					</div>
					{bottomTerminalOpen && bottomTerminalTaskId ? (
						<BottomTerminalSection
							taskId={bottomTerminalTaskId}
							workspaceId={workspaceId}
							summary={bottomTerminalSummary}
							onSummary={onSessionSummary}
							onClose={onBottomTerminalClose}
							subtitle={bottomTerminalSubtitle}
							terminalThemeColors={terminalThemeColors}
							onConnectionReady={onBottomTerminalConnectionReady}
							agentCommand={bottomTerminalAgentCommand}
							onSendAgentCommand={onBottomTerminalSendAgentCommand}
							paneHeight={bottomTerminalPaneHeight}
							onPaneHeightChange={onBottomTerminalPaneHeightChange}
							onCollapse={onBottomTerminalCollapse}
							isExpanded={isBottomTerminalExpanded}
							onToggleExpand={onBottomTerminalToggleExpand}
						/>
					) : null}
				</>
			</div>
		</div>
	);
}
