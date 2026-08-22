import { type BeforeCapture, DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { BoardCard } from "@/components/board-card";
import { Button } from "@/components/ui/button";
import { ColumnIndicator } from "@/components/ui/column-indicator";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { findCardColumnId, isCardDropDisabled } from "@/state/drag-rules";
import {
	type BoardCard as BoardCardModel,
	type BoardColumn,
	type BoardColumnId,
	type CardSelection,
	isReviewLikeColumnId,
} from "@/types";

function ColumnSection({
	column,
	selectedCardId,
	defaultOpen,
	onCardClick,
	taskSessions,
	onCreateTask,
	onBranchTask,
	onClearTrash,
	onSaveTitle,
	onCommitTask,
	onOpenPrTask,
	onMoveToTrashTask,
	onRestoreFromTrashTask,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	moveToTrashLoadingById,
	activeDragSourceColumnId,
	workspacePath,
}: {
	column: BoardColumn;
	selectedCardId: string;
	defaultOpen: boolean;
	onCardClick: (card: BoardCardModel) => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	onBranchTask?: (task: BoardCardModel) => void;
	onClearTrash?: () => void;
	onSaveTitle?: (taskId: string, title: string) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	onRestoreFromTrashTask?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	activeDragSourceColumnId?: BoardColumnId | null;
	workspacePath?: string | null;
}): React.ReactElement {
	const [open, setOpen] = useState(defaultOpen);
	const canCreate = column.id === "in_progress" && onCreateTask;
	const canClearTrash = column.id === "trash" && onClearTrash;
	const cardDropType = "CARD";
	const isDropDisabled = isCardDropDisabled(column.id, activeDragSourceColumnId ?? null);

	useEffect(() => {
		if (!column.cards.some((card) => card.id === selectedCardId)) {
			return;
		}
		setOpen(true);
	}, [column.cards, selectedCardId]);

	return (
		<div className="bg-surface-1 rounded-lg shrink-0 border border-border">
			<div
				style={{
					display: "flex",
					alignItems: "center",
					height: 40,
				}}
			>
				<button
					type="button"
					onClick={() => setOpen((prev) => !prev)}
					className="hover:bg-surface-0 rounded-md"
					style={{
						height: 32,
						flex: "1 1 auto",
						minWidth: 0,
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "0 8px",
						margin: "0 4px",
						background: "none",
						border: "none",
						cursor: "pointer",
						color: "inherit",
						textAlign: "left",
					}}
				>
					{open ? (
						<ChevronDown size={16} className="text-text-secondary" style={{ flexShrink: 0 }} />
					) : (
						<ChevronRight size={16} className="text-text-secondary" style={{ flexShrink: 0 }} />
					)}
					<span style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<ColumnIndicator columnId={column.id} />
						<span style={{ fontWeight: 600, fontSize: 13 }}>{column.title}</span>
						<span className="text-text-secondary" style={{ fontSize: 11 }}>
							{column.cards.length}
						</span>
					</span>
				</button>
				{canClearTrash ? (
					<Button
						icon={<Trash2 size={14} />}
						variant="ghost"
						size="sm"
						className="text-status-red hover:text-status-red"
						onClick={onClearTrash}
						disabled={column.cards.length === 0}
						aria-label="Clear done"
						title={column.cards.length > 0 ? "Clear done items permanently" : "Done is empty"}
						style={{ marginRight: 4 }}
					/>
				) : null}
			</div>
			<div style={{ display: open ? "block" : "none" }}>
				<Droppable droppableId={column.id} type={cardDropType} isDropDisabled={isDropDisabled}>
					{(provided) => {
						return (
							<div
								ref={provided.innerRef}
								{...provided.droppableProps}
								style={{
									display: "flex",
									flexDirection: "column",
									padding: 8,
								}}
							>
								{canCreate ? (
									<Button
										icon={<span style={{ fontSize: 16, lineHeight: 1 }}>+</span>}
										aria-label="Create task"
										fill
										onClick={onCreateTask}
										style={{ marginBottom: 8 }}
									>
										<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
											<span>Create task</span>
											<span aria-hidden className="text-text-secondary">
												(c)
											</span>
										</span>
									</Button>
								) : null}
								{(() => {
									const items: ReactNode[] = [];
									let draggableIndex = 0;
									for (const card of column.cards) {
										items.push(
											<BoardCard
												key={card.id}
												card={card}
												index={draggableIndex}
												columnId={column.id}
												sessionSummary={taskSessions[card.id]}
												selected={card.id === selectedCardId}
												onBranch={onBranchTask}
												onMoveToTrash={onMoveToTrashTask}
												onRestoreFromTrash={onRestoreFromTrashTask}
												onCommit={onCommitTask}
												onOpenPr={onOpenPrTask}
												isCommitLoading={commitTaskLoadingById?.[card.id] ?? false}
												isOpenPrLoading={openPrTaskLoadingById?.[card.id] ?? false}
												isMoveToTrashLoading={moveToTrashLoadingById?.[card.id] ?? false}
												workspacePath={workspacePath}
												onSaveTitle={onSaveTitle}
												onClick={() => onCardClick(card)}
											/>,
										);
										draggableIndex += 1;
									}
									return items;
								})()}
								{provided.placeholder}
								{column.cards.length === 0 ? (
									<div className="flex items-center justify-center py-4 text-text-tertiary text-xs">Empty</div>
								) : null}
							</div>
						);
					}}
				</Droppable>
			</div>
		</div>
	);
}

export function ColumnContextPanel({
	selection,
	workspacePath,
	onCardSelect,
	taskSessions,
	onTaskDragEnd,
	onCreateTask,
	onBranchTask,
	onClearTrash,
	onSaveTaskTitle,
	onCommitTask,
	onOpenPrTask,
	onMoveToTrashTask,
	onRestoreFromTrashTask,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	moveToTrashLoadingById,
	panelWidth,
}: {
	selection: CardSelection;
	workspacePath?: string | null;
	onCardSelect: (taskId: string) => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	onBranchTask?: (task: BoardCardModel) => void;
	onClearTrash?: () => void;
	onSaveTaskTitle?: (taskId: string, title: string) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	onRestoreFromTrashTask?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	panelWidth?: string;
}): React.ReactElement {
	const [activeDragSourceColumnId, setActiveDragSourceColumnId] = useState<BoardColumnId | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);

	const handleBeforeCapture = useCallback(
		(start: BeforeCapture) => {
			setActiveDragSourceColumnId(findCardColumnId(selection.allColumns, start.draggableId));
		},
		[selection.allColumns],
	);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			setActiveDragSourceColumnId(null);
			onTaskDragEnd(result);
		},
		[onTaskDragEnd],
	);

	useEffect(() => {
		const scrollContainer = scrollContainerRef.current;
		if (!scrollContainer) {
			return;
		}
		const escapedTaskId = selection.card.id.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
		const selectedCardElement = scrollContainer.querySelector<HTMLElement>(`[data-task-id="${escapedTaskId}"]`);
		if (!selectedCardElement) {
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			selectedCardElement.scrollIntoView({
				block: "center",
				inline: "nearest",
			});
		});
		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [selection.card.id, selection.column.id]);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: panelWidth ?? "20%",
				minHeight: 0,
				overflow: "hidden",
				background: "var(--color-surface-0)",
			}}
		>
			<DragDropContext onBeforeCapture={handleBeforeCapture} onDragEnd={handleDragEnd}>
				<div
					ref={scrollContainerRef}
					className="flex flex-col gap-2 p-2"
					style={{
						flex: "1 1 0",
						minHeight: 0,
						overflowY: "auto",
						overscrollBehavior: "contain",
						overflowAnchor: "none",
					}}
				>
					{selection.allColumns.map((column) => (
						<ColumnSection
							key={column.id}
							column={column}
							selectedCardId={selection.card.id}
							defaultOpen={column.id !== "trash"}
							onCardClick={(card) => onCardSelect(card.id)}
							taskSessions={taskSessions}
							onCreateTask={column.id === "in_progress" ? onCreateTask : undefined}
							onBranchTask={column.id !== "trash" ? onBranchTask : undefined}
							onClearTrash={column.id === "trash" ? onClearTrash : undefined}
							onSaveTitle={column.id !== "trash" ? onSaveTaskTitle : undefined}
							onCommitTask={isReviewLikeColumnId(column.id) ? onCommitTask : undefined}
							onOpenPrTask={isReviewLikeColumnId(column.id) ? onOpenPrTask : undefined}
							onMoveToTrashTask={isReviewLikeColumnId(column.id) ? onMoveToTrashTask : undefined}
							onRestoreFromTrashTask={column.id === "trash" ? onRestoreFromTrashTask : undefined}
							commitTaskLoadingById={isReviewLikeColumnId(column.id) ? commitTaskLoadingById : undefined}
							openPrTaskLoadingById={isReviewLikeColumnId(column.id) ? openPrTaskLoadingById : undefined}
							moveToTrashLoadingById={isReviewLikeColumnId(column.id) ? moveToTrashLoadingById : undefined}
							activeDragSourceColumnId={activeDragSourceColumnId}
							workspacePath={workspacePath}
						/>
					))}
				</div>
			</DragDropContext>
		</div>
	);
}
