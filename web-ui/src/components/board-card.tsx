import { Draggable } from "@hello-pangea/dnd";
import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import { AlertCircle, AlertTriangle, Bot, Copy, Layers3, RotateCcw, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";
import { type BoardCard as BoardCardModel, type BoardColumnId, isReviewLikeColumnId } from "@/types";
import { formatPathForDisplay } from "@/utils/path-display";

interface CardSessionActivity {
	dotColor: string;
	text: string;
}

const SESSION_ACTIVITY_COLOR = {
	thinking: "var(--color-status-blue)",
	success: "var(--color-status-green)",
	waiting: "var(--color-status-gold)",
	error: "var(--color-status-red)",
	warning: "var(--color-status-orange)",
	muted: "var(--color-text-tertiary)",
	secondary: "var(--color-text-secondary)",
} as const;

function extractToolInputSummaryFromActivityText(activityText: string, toolName: string): string | null {
	const escapedToolName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = activityText.match(
		new RegExp(`^(?:Using|Completed|Failed|Calling)\\s+${escapedToolName}(?::\\s*(.+))?$`),
	);
	if (!match) {
		return null;
	}
	const rawSummary = match[1]?.trim() ?? "";
	if (!rawSummary) {
		return null;
	}
	if (activityText.startsWith("Failed ")) {
		const [operationSummary] = rawSummary.split(": ");
		return operationSummary?.trim() || null;
	}
	return rawSummary;
}

function parseToolCallFromActivityText(
	activityText: string,
): { toolName: string; toolInputSummary: string | null } | null {
	const match = activityText.match(/^(?:Using|Completed|Failed|Calling)\s+([^:()]+?)(?::\s*(.+))?$/);
	if (!match?.[1]) {
		return null;
	}
	const toolName = match[1].trim();
	if (!toolName) {
		return null;
	}
	const rawSummary = match[2]?.trim() ?? "";
	if (!rawSummary) {
		return { toolName, toolInputSummary: null };
	}
	if (activityText.startsWith("Failed ")) {
		const [operationSummary] = rawSummary.split(": ");
		return {
			toolName,
			toolInputSummary: operationSummary?.trim() || null,
		};
	}
	return {
		toolName,
		toolInputSummary: rawSummary,
	};
}

function resolveToolCallLabel(
	activityText: string | undefined,
	toolName: string | null,
	toolInputSummary: string | null,
): string | null {
	if (toolName) {
		const parsedSummary = extractToolInputSummaryFromActivityText(activityText ?? "", toolName);
		const summary = toolInputSummary ?? parsedSummary;
		return summary ? `${toolName}: ${summary}` : toolName;
	}
	if (!activityText) {
		return null;
	}
	const parsed = parseToolCallFromActivityText(activityText);
	if (!parsed) {
		return null;
	}
	return parsed.toolInputSummary ? `${parsed.toolName}: ${parsed.toolInputSummary}` : parsed.toolName;
}

function isCardCreditLimitError(summary: RuntimeTaskSessionSummary | undefined): boolean {
	if (!summary) {
		return false;
	}
	if (summary.state !== "awaiting_review" && summary.state !== "failed" && summary.state !== "interrupted") {
		return false;
	}
	return summary.latestHookActivity?.notificationType === "credit_limit";
}

function getCardSessionActivity(summary: RuntimeTaskSessionSummary | undefined): CardSessionActivity | null {
	if (!summary) {
		return null;
	}
	if (isCardCreditLimitError(summary)) {
		return { dotColor: SESSION_ACTIVITY_COLOR.warning, text: "Out of credits" };
	}
	const hookActivity = summary.latestHookActivity;
	const activityText = hookActivity?.activityText?.trim();
	const toolName = hookActivity?.toolName?.trim() ?? null;
	const toolInputSummary = hookActivity?.toolInputSummary?.trim() ?? null;
	const finalMessage = hookActivity?.finalMessage?.trim();
	const hookEventName = hookActivity?.hookEventName?.trim() ?? null;
	if (summary.state === "awaiting_review" && finalMessage) {
		return { dotColor: SESSION_ACTIVITY_COLOR.success, text: finalMessage };
	}
	if (
		finalMessage &&
		!toolName &&
		(hookEventName === "assistant_delta" || hookEventName === "agent_end" || hookEventName === "turn_start")
	) {
		return {
			dotColor: summary.state === "running" ? SESSION_ACTIVITY_COLOR.thinking : SESSION_ACTIVITY_COLOR.success,
			text: finalMessage,
		};
	}
	if (activityText) {
		let dotColor: string =
			summary.state === "failed" ? SESSION_ACTIVITY_COLOR.error : SESSION_ACTIVITY_COLOR.thinking;
		let text = activityText;
		const isToolActivity =
			/^(?:Using|Completed|Failed|Calling)\s/.test(activityText) ||
			["tool_call", "tool_result", "preToolUse", "postToolUse", "raw_response_item"].includes(hookEventName ?? "");
		const toolCallLabel = isToolActivity ? resolveToolCallLabel(activityText, toolName, toolInputSummary) : null;
		if (toolCallLabel) {
			if (text.startsWith("Failed ")) {
				dotColor = SESSION_ACTIVITY_COLOR.error;
			}
			return {
				dotColor,
				text: toolCallLabel,
			};
		}
		if (text.startsWith("Final: ")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
			text = text.slice(7);
		} else if (text.startsWith("Agent: ")) {
			text = text.slice(7);
		} else if (text.startsWith("Waiting for approval")) {
			dotColor = SESSION_ACTIVITY_COLOR.waiting;
		} else if (text.startsWith("Waiting for review")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
		} else if (text.startsWith("Failed ")) {
			dotColor = SESSION_ACTIVITY_COLOR.error;
		} else if (text === "Agent active" || text === "Working on task" || text.startsWith("Resumed")) {
			return { dotColor: SESSION_ACTIVITY_COLOR.thinking, text: "Thinking..." };
		}
		return { dotColor, text };
	}
	if (summary.state === "failed") {
		const failedText = finalMessage ?? activityText ?? "Task failed to start";
		return { dotColor: SESSION_ACTIVITY_COLOR.error, text: failedText };
	}
	if (summary.state === "awaiting_review") {
		return { dotColor: SESSION_ACTIVITY_COLOR.success, text: "Waiting for review" };
	}
	if (summary.state === "running") {
		return { dotColor: SESSION_ACTIVITY_COLOR.thinking, text: "Thinking..." };
	}
	return null;
}

export function BoardCard({
	card,
	index,
	columnId,
	sessionSummary,
	selected = false,
	onClick,
	onBranch,
	onMoveToTrash,
	onRestoreFromTrash,
	isMoveToTrashLoading = false,
	isDragDisabled = false,
	hideActions = false,
	wrapTitle = false,
}: {
	card: BoardCardModel;
	index: number;
	columnId: BoardColumnId;
	sessionSummary?: RuntimeTaskSessionSummary;
	selected?: boolean;
	onClick?: () => void;
	onBranch?: (task: BoardCardModel) => void;
	onMoveToTrash?: (taskId: string) => void;
	onRestoreFromTrash?: (taskId: string) => void;
	isMoveToTrashLoading?: boolean;
	isDragDisabled?: boolean;
	hideActions?: boolean;
	wrapTitle?: boolean;
}): React.ReactElement {
	const [isHovered, setIsHovered] = useState(false);
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(card.id);
	const isTrashCard = columnId === "trash";
	const isCardInteractive = !isTrashCard;
	const rawSessionActivity = useMemo(() => getCardSessionActivity(sessionSummary), [sessionSummary]);
	const lastSessionActivityRef = useRef<CardSessionActivity | null>(null);
	const lastSessionActivityCardIdRef = useRef<string | null>(null);
	if (lastSessionActivityCardIdRef.current !== card.id) {
		lastSessionActivityCardIdRef.current = card.id;
		lastSessionActivityRef.current = null;
	}
	if (rawSessionActivity) {
		lastSessionActivityRef.current = rawSessionActivity;
	}
	const sessionActivity = rawSessionActivity ?? lastSessionActivityRef.current;
	const displayTitle = card.title;

	const stopEvent = (event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const isCreditLimit = isCardCreditLimitError(sessionSummary);
	const renderStatusMarker = () => {
		if (isCreditLimit) {
			return <AlertTriangle size={12} className="text-status-orange" />;
		}
		if (columnId === "in_progress") {
			if (sessionSummary?.state === "failed") {
				return <AlertCircle size={12} className="text-status-red" />;
			}
			return null;
		}
		return null;
	};
	const statusMarker = renderStatusMarker();
	const showWorkspaceStatus = !isTrashCard && (columnId === "in_progress" || isReviewLikeColumnId(columnId));
	const reviewWorkspacePath = reviewWorkspaceSnapshot ? formatPathForDisplay(reviewWorkspaceSnapshot.path) : null;
	const agentOverrideLabel = useMemo(
		() => (card.agentId ? (getRuntimeAgentCatalogEntry(card.agentId)?.label ?? card.agentId) : null),
		[card.agentId],
	);
	const taskAgentSettingsLabel = agentOverrideLabel;
	const showDeepViewActions =
		wrapTitle &&
		!hideActions &&
		((Boolean(onBranch) && !isTrashCard) || Boolean(onMoveToTrash) || (isTrashCard && Boolean(onRestoreFromTrash)));

	return (
		<Draggable draggableId={card.id} index={index} isDragDisabled={isDragDisabled}>
			{(provided, snapshot) => {
				const isDragging = snapshot.isDragging;
				const draggableContent = (
					<div
						ref={provided.innerRef}
						{...provided.draggableProps}
						{...provided.dragHandleProps}
						className="kb-board-card-shell"
						data-task-id={card.id}
						data-column-id={columnId}
						data-selected={selected}
						onClick={(event) => {
							if (!isCardInteractive) {
								return;
							}
							const target = event.target as HTMLElement | null;
							if (target?.closest("button, a, input, textarea, [contenteditable='true']")) {
								return;
							}
							if (!snapshot.isDragging && onClick) {
								onClick();
							}
						}}
						style={{
							...provided.draggableProps.style,
							marginBottom: 6,
							cursor: isDragDisabled ? "default" : "grab",
						}}
						onMouseEnter={() => setIsHovered(true)}
						onMouseLeave={() => setIsHovered(false)}
					>
						<div
							className={cn(
								"rounded-md border border-border-bright bg-surface-2 p-2.5",
								isCardInteractive && "cursor-pointer hover:bg-surface-3 hover:border-border-bright",
								isDragging && "shadow-lg",
								isHovered && isCardInteractive && "bg-surface-3 border-border-bright",
							)}
						>
							<div className="flex items-start gap-2" style={{ minHeight: 24 }}>
								{statusMarker ? <div className="mt-1 inline-flex items-center">{statusMarker}</div> : null}
								<p
									className={cn(
										"m-0 min-w-0 flex-1 font-medium text-sm",
										wrapTitle ? "break-words whitespace-normal" : "kb-line-clamp-1",
										isTrashCard && "line-through text-text-tertiary",
									)}
								>
									{displayTitle}
								</p>
								{!wrapTitle && onBranch && !isTrashCard ? (
									<Tooltip content="Branch task">
										<Button
											icon={<Copy size={13} />}
											variant="ghost"
											size="sm"
											aria-label="Branch task"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onBranch(card);
											}}
										/>
									</Tooltip>
								) : null}
								{!wrapTitle && !hideActions && onMoveToTrash ? (
									<Button
										icon={isMoveToTrashLoading ? <Spinner size={13} /> : <Trash2 size={13} />}
										variant="danger"
										size="sm"
										className="h-7 w-7 p-0"
										disabled={isMoveToTrashLoading}
										aria-label="Move task to done"
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onMoveToTrash?.(card.id);
										}}
									/>
								) : !wrapTitle && !hideActions && columnId === "trash" ? (
									<Tooltip
										side="bottom"
										content={
											<>
												Restore session
												<br />
												in new worktree
											</>
										}
									>
										<Button
											icon={<RotateCcw size={12} />}
											variant="ghost"
											size="sm"
											aria-label="Restore task from done"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onRestoreFromTrash?.(card.id);
											}}
										/>
									</Tooltip>
								) : null}
							</div>
							{taskAgentSettingsLabel ? (
								<div className="mt-1">
									<span
										className={cn(
											"inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
											isTrashCard
												? "border-border text-text-tertiary bg-surface-1"
												: "border-status-blue/30 bg-status-blue/10 text-status-blue",
										)}
									>
										<Bot size={12} className="shrink-0" />
										<span className="truncate">{taskAgentSettingsLabel}</span>
									</span>
								</div>
							) : null}
							{card.projectName ? (
								<div className="mt-1.5">
									<span
										className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-bright bg-surface-1 px-1.5 py-0.5 text-xs text-text-secondary"
										title={card.projectPath}
									>
										<Layers3 size={11} className="shrink-0 text-accent" />
										<span className="truncate">{card.projectName}</span>
									</span>
								</div>
							) : null}
							{sessionActivity ? (
								<div
									className="flex gap-1.5 items-start mt-[6px]"
									style={{
										color: isTrashCard ? SESSION_ACTIVITY_COLOR.muted : undefined,
									}}
								>
									<span
										className="inline-block shrink-0 rounded-full"
										style={{
											width: 6,
											height: 6,
											backgroundColor: isTrashCard ? SESSION_ACTIVITY_COLOR.muted : sessionActivity.dotColor,
											marginTop: 4,
										}}
									/>
									<div className="min-w-0 flex-1">
										<p className="m-0 font-mono truncate" style={{ fontSize: 12 }}>
											{sessionActivity.text}
										</p>
									</div>
								</div>
							) : null}
							{showWorkspaceStatus && reviewWorkspacePath ? (
								<p
									className="font-mono"
									style={{
										margin: "4px 0 0",
										fontSize: 12,
										lineHeight: 1.4,
										whiteSpace: "normal",
										overflowWrap: "anywhere",
										color: SESSION_ACTIVITY_COLOR.secondary,
									}}
								>
									{reviewWorkspacePath}
								</p>
							) : null}
							{showDeepViewActions ? (
								<div className="-mx-2.5 -mb-2.5 mt-2 flex items-center justify-end gap-1 border-t border-border bg-surface-1/55 px-2.5 py-1.5">
									{onBranch && !isTrashCard ? (
										<Button
											icon={<Copy size={12} />}
											variant="ghost"
											size="sm"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onBranch(card);
											}}
										>
											Branch
										</Button>
									) : null}
									{onMoveToTrash ? (
										<Button
											icon={isMoveToTrashLoading ? <Spinner size={12} /> : <Trash2 size={12} />}
											variant="danger"
											size="sm"
											disabled={isMoveToTrashLoading}
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onMoveToTrash(card.id);
											}}
										>
											Done
										</Button>
									) : isTrashCard && onRestoreFromTrash ? (
										<Button
											icon={<RotateCcw size={12} />}
											variant="ghost"
											size="sm"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onRestoreFromTrash(card.id);
											}}
										>
											Restore
										</Button>
									) : null}
								</div>
							) : null}
						</div>
					</div>
				);

				if (isDragging && typeof document !== "undefined") {
					return createPortal(draggableContent, document.body);
				}
				return draggableContent;
			}}
		</Draggable>
	);
}
