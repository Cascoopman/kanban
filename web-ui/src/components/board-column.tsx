import { Droppable } from "@hello-pangea/dnd";
import { EyeOff, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { BoardCard } from "@/components/board-card";
import { Button } from "@/components/ui/button";
import { ColumnIndicator } from "@/components/ui/column-indicator";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { isCardDropDisabled, type ProgrammaticCardMoveInFlight } from "@/state/drag-rules";
import { getTaskDependencies, getUnresolvedTaskDependencies } from "@/state/task-dependency-state";
import type { BoardCard as BoardCardModel, BoardColumnId, BoardColumn as BoardColumnModel, BoardData } from "@/types";

export function BoardColumn({
	column,
	board,
	taskSessions,
	onCreateTask,
	onBranchTask,
	onClearTrash,
	onHide,
	onMoveToTrashTask,
	onRestoreFromTrashTask,
	moveToTrashLoadingById,
	onCardClick,
	activeDragTaskId,
	activeDragSourceColumnId,
	programmaticCardMoveInFlight,
	isDragDisabled = false,
	hideCardActions = false,
}: {
	column: BoardColumnModel;
	board: BoardData;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	onBranchTask?: (task: BoardCardModel) => void;
	onClearTrash?: () => void;
	onHide?: () => void;
	onMoveToTrashTask?: (taskId: string) => void;
	onRestoreFromTrashTask?: (taskId: string) => void;
	moveToTrashLoadingById?: Record<string, boolean>;
	onCardClick?: (card: BoardCardModel) => void;
	activeDragTaskId?: string | null;
	activeDragSourceColumnId?: BoardColumnId | null;
	programmaticCardMoveInFlight?: ProgrammaticCardMoveInFlight | null;
	isDragDisabled?: boolean;
	hideCardActions?: boolean;
}): React.ReactElement {
	const canCreate = column.id === "in_progress" && onCreateTask;
	const canClearTrash = column.id === "trash" && onClearTrash;
	const cardDropType = "CARD";
	const isDropDisabled = isCardDropDisabled(column.id, activeDragSourceColumnId ?? null, {
		activeDragTaskId,
		programmaticCardMoveInFlight,
	});
	const createTaskButtonText = (
		<span className="inline-flex items-center gap-1.5">
			<span>Create task</span>
			<span aria-hidden className="text-text-secondary">
				(c)
			</span>
		</span>
	);

	return (
		<section
			data-column-id={column.id}
			className="flex flex-col min-w-0 min-h-0 bg-surface-1 rounded-lg overflow-hidden border border-border"
			style={{
				flex: "1 1 0",
			}}
		>
			<div className="flex flex-col min-h-0" style={{ flex: "1 1 0" }}>
				<div
					className="flex items-center justify-between"
					style={{
						height: 40,
						padding: "0 12px",
					}}
				>
					<div className="flex items-center gap-2">
						<ColumnIndicator columnId={column.id} />
						<span className="font-semibold text-sm">{column.title}</span>
						<span className="text-text-secondary text-xs">{column.cards.length}</span>
					</div>
					<div className="flex items-center gap-0.5">
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
							/>
						) : null}
						{onHide ? (
							<Button
								icon={<EyeOff size={14} />}
								variant="ghost"
								size="sm"
								onClick={onHide}
								aria-label={`Hide ${column.title} column`}
								title={`Hide ${column.title} column`}
							/>
						) : null}
					</div>
				</div>

				<Droppable droppableId={column.id} type={cardDropType} isDropDisabled={isDropDisabled || isDragDisabled}>
					{(cardProvided) => (
						<div ref={cardProvided.innerRef} {...cardProvided.droppableProps} className="kb-column-cards">
							{canCreate ? (
								<Button
									icon={<Plus size={14} />}
									aria-label="Create task"
									fill
									onClick={onCreateTask}
									style={{ marginBottom: 6, flexShrink: 0 }}
								>
									{createTaskButtonText}
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
											onBranch={onBranchTask}
											onMoveToTrash={onMoveToTrashTask}
											onRestoreFromTrash={onRestoreFromTrashTask}
											isMoveToTrashLoading={moveToTrashLoadingById?.[card.id] ?? false}
											isDragDisabled={isDragDisabled}
											hideActions={hideCardActions}
											dependencySummary={{
												total: getTaskDependencies(board, card).length,
												unresolved: getUnresolvedTaskDependencies(board, card).length,
											}}
											onClick={() => onCardClick?.(card)}
										/>,
									);
									draggableIndex += 1;
								}
								return items;
							})()}
							{cardProvided.placeholder}
						</div>
					)}
				</Droppable>
			</div>
		</section>
	);
}
