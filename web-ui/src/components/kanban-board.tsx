import {
	type BeforeCapture,
	DragDropContext,
	type DragStart,
	type DropResult,
	type FluidDragActions,
	type Sensor,
	type SensorAPI,
	type SnapDragActions,
} from "@hello-pangea/dnd";
import { useCallback, useEffect, useRef, useState } from "react";

import { BoardColumn } from "@/components/board-column";
import { HiddenBoardColumn } from "@/components/hidden-board-column";
import { useBoardColumnVisibility } from "@/hooks/use-board-column-visibility";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { findCardColumnId, type ProgrammaticCardMoveInFlight } from "@/state/drag-rules";
import { type BoardCard, type BoardColumnId, type BoardData, isReviewLikeColumnId } from "@/types";

const BOARD_COLUMN_ORDER: BoardColumnId[] = ["in_progress", "review", "on_hold", "trash"];

export type RequestProgrammaticCardMove = (move: ProgrammaticCardMoveInFlight) => boolean;

function isRectVerticallyVisibleWithinContainer(rect: DOMRect, containerRect: DOMRect): boolean {
	return rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
}

export function KanbanBoard({
	data,
	taskSessions,
	onCardSelect,
	onCreateTask,
	onBranchTask,
	onClearTrash,
	onMoveToTrashTask,
	onRestoreFromTrashTask,
	moveToTrashLoadingById,
	onDragEnd,
	onRequestProgrammaticCardMoveReady,
	workspacePath,
	isDragDisabled = false,
	hideCardActions = false,
}: {
	data: BoardData;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCardSelect: (taskId: string) => void;
	onCreateTask?: () => void;
	onBranchTask?: (task: BoardCard) => void;
	onClearTrash?: () => void;
	onMoveToTrashTask?: (taskId: string) => void;
	onRestoreFromTrashTask?: (taskId: string) => void;
	moveToTrashLoadingById?: Record<string, boolean>;
	onDragEnd?: (result: DropResult) => void;
	onRequestProgrammaticCardMoveReady?: (requestMove: RequestProgrammaticCardMove | null) => void;
	workspacePath?: string | null;
	isDragDisabled?: boolean;
	hideCardActions?: boolean;
}): React.ReactElement {
	const dragOccurredRef = useRef(false);
	const boardRef = useRef<HTMLElement>(null);
	const sensorApiRef = useRef<SensorAPI | null>(null);
	const latestDataRef = useRef<BoardData>(data);
	const programmaticCardMoveInFlightRef = useRef<ProgrammaticCardMoveInFlight | null>(null);
	const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);

	const [activeDragSourceColumnId, setActiveDragSourceColumnId] = useState<BoardColumnId | null>(null);
	const [programmaticCardMoveInFlight, setProgrammaticCardMoveInFlight] =
		useState<ProgrammaticCardMoveInFlight | null>(null);
	const { isColumnHidden, hideColumn, showColumn } = useBoardColumnVisibility();

	useEffect(() => {
		latestDataRef.current = data;
	}, [data]);

	const programmaticSensor: Sensor = useCallback((api: SensorAPI) => {
		sensorApiRef.current = api;
	}, []);

	const getElementClientCenter = useCallback((element: HTMLElement): { x: number; y: number } => {
		const rect = element.getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		};
	}, []);

	const canAnimateProgrammaticTopInsertion = useCallback((taskId: string, targetColumnId: BoardColumnId): boolean => {
		const boardElement = boardRef.current;
		if (!boardElement) {
			return false;
		}
		const sourceCardElement = boardElement.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
		const sourceColumnId = findCardColumnId(latestDataRef.current.columns, taskId);
		const sourceColumnElement = sourceColumnId
			? boardElement.querySelector<HTMLElement>(`section[data-column-id="${sourceColumnId}"]`)
			: null;
		const sourceCardsElement = sourceColumnElement?.querySelector<HTMLElement>(".kb-column-cards");
		const targetColumnElement = boardElement.querySelector<HTMLElement>(`[data-column-id="${targetColumnId}"]`);
		const targetCardsElement = targetColumnElement?.querySelector<HTMLElement>(".kb-column-cards");
		if (!sourceCardElement || !sourceCardsElement || !targetCardsElement) {
			return false;
		}

		const sourceCardRect = sourceCardElement.getBoundingClientRect();
		const sourceCardsRect = sourceCardsElement.getBoundingClientRect();
		if (!isRectVerticallyVisibleWithinContainer(sourceCardRect, sourceCardsRect)) {
			return false;
		}

		if (targetCardsElement.scrollTop > 1) {
			return false;
		}

		const firstTargetCardElement = targetCardsElement.querySelector<HTMLElement>("[data-task-id]");
		if (firstTargetCardElement) {
			const firstTargetCardRect = firstTargetCardElement.getBoundingClientRect();
			return isRectVerticallyVisibleWithinContainer(firstTargetCardRect, targetCardsElement.getBoundingClientRect());
		}

		return true;
	}, []);

	const getProgrammaticTopTargetClientSelection = useCallback(
		(taskId: string, targetColumnId: BoardColumnId): { x: number; y: number } | null => {
			const boardElement = boardRef.current;
			if (!boardElement) {
				return null;
			}
			const sourceCardElement = boardElement.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
			const targetColumnElement = boardElement.querySelector<HTMLElement>(`[data-column-id="${targetColumnId}"]`);
			const targetCardsElement = targetColumnElement?.querySelector<HTMLElement>(".kb-column-cards");
			if (!sourceCardElement || !targetCardsElement) {
				return null;
			}

			const sourceCardRect = sourceCardElement.getBoundingClientRect();
			const firstTargetCardElement = targetCardsElement.querySelector<HTMLElement>("[data-task-id]");
			if (firstTargetCardElement) {
				const targetRect = firstTargetCardElement.getBoundingClientRect();
				const desiredCenterY = targetRect.top + sourceCardRect.height / 2;
				const maxTopInsertCenterY = targetRect.top + targetRect.height / 2 - 1;
				return {
					x: targetRect.left + sourceCardRect.width / 2,
					y: Math.min(desiredCenterY, maxTopInsertCenterY),
				};
			}
			const targetRect = targetCardsElement.getBoundingClientRect();
			const targetCardsStyle = window.getComputedStyle(targetCardsElement);
			const paddingTop = Number.parseFloat(targetCardsStyle.paddingTop) || 0;
			const paddingLeft = Number.parseFloat(targetCardsStyle.paddingLeft) || 0;
			return {
				x: targetRect.left + paddingLeft + sourceCardRect.width / 2,
				y: targetRect.top + paddingTop + sourceCardRect.height / 2,
			};
		},
		[],
	);

	const clearProgrammaticCardMoveInFlight = useCallback((taskId?: string) => {
		if (taskId && programmaticCardMoveInFlightRef.current?.taskId !== taskId) {
			return;
		}
		programmaticCardMoveInFlightRef.current = null;
		setProgrammaticCardMoveInFlight(null);
	}, []);

	const requestProgrammaticCardMove = useCallback<RequestProgrammaticCardMove>(
		(move) => {
			const { taskId, toColumnId: targetColumnId } = move;
			if (isColumnHidden(move.fromColumnId) || isColumnHidden(targetColumnId)) {
				return false;
			}
			const board = latestDataRef.current;
			const sourceColumnId = findCardColumnId(board.columns, taskId);
			if (!sourceColumnId || sourceColumnId !== move.fromColumnId || sourceColumnId === targetColumnId) {
				return false;
			}

			const sensorApi = sensorApiRef.current;
			if (!sensorApi) {
				return false;
			}

			const visibleColumnOrder = BOARD_COLUMN_ORDER.filter((columnId) => !isColumnHidden(columnId));
			const sourceOrderIndex = visibleColumnOrder.indexOf(sourceColumnId);
			const targetOrderIndex = visibleColumnOrder.indexOf(targetColumnId);
			if (sourceOrderIndex < 0 || targetOrderIndex < 0) {
				return false;
			}
			if (move.insertAtTop && !canAnimateProgrammaticTopInsertion(taskId, targetColumnId)) {
				return false;
			}

			const horizontalSteps = targetOrderIndex - sourceOrderIndex;
			programmaticCardMoveInFlightRef.current = move;
			setProgrammaticCardMoveInFlight(move);
			const preDrag = sensorApi.tryGetLock(taskId);
			if (!preDrag) {
				clearProgrammaticCardMoveInFlight(taskId);
				return false;
			}

			const sourceCardElement = boardRef.current?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`) ?? null;
			const topTargetClientSelection = move.insertAtTop
				? getProgrammaticTopTargetClientSelection(taskId, targetColumnId)
				: null;
			if (sourceCardElement && topTargetClientSelection) {
				let dragActions: FluidDragActions;
				try {
					dragActions = preDrag.fluidLift(getElementClientCenter(sourceCardElement));
				} catch {
					clearProgrammaticCardMoveInFlight(taskId);
					if (preDrag.isActive()) {
						preDrag.abort();
					}
					return false;
				}

				const startClientSelection = getElementClientCenter(sourceCardElement);
				const startTime = performance.now();
				const deltaX = topTargetClientSelection.x - startClientSelection.x;
				const deltaY = topTargetClientSelection.y - startClientSelection.y;
				const travelDistance = Math.hypot(deltaX, deltaY);
				const durationMs = Math.min(224, Math.max(133, 102 + travelDistance * 0.126)) * 0.5;
				const easeInOutCubic = (value: number) => (value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2);
				const animate = (frameTime: number) => {
					if (!dragActions.isActive()) {
						return;
					}
					try {
						const progress = Math.min((frameTime - startTime) / durationMs, 1);
						const easedProgress = easeInOutCubic(progress);
						dragActions.move({
							x: startClientSelection.x + deltaX * easedProgress,
							y: startClientSelection.y + deltaY * easedProgress,
						});
						if (progress >= 1) {
							dragActions.drop();
							return;
						}
						window.requestAnimationFrame(animate);
					} catch {
						clearProgrammaticCardMoveInFlight(taskId);
						if (dragActions.isActive()) {
							dragActions.cancel();
						}
					}
				};

				window.requestAnimationFrame(animate);
				return true;
			}

			let dragActions: SnapDragActions;
			try {
				dragActions = preDrag.snapLift();
			} catch {
				clearProgrammaticCardMoveInFlight(taskId);
				if (preDrag.isActive()) {
					preDrag.abort();
				}
				return false;
			}

			const moveOneStep = horizontalSteps > 0 ? dragActions.moveRight : dragActions.moveLeft;
			const moveSteps: Array<() => void> = [];
			for (let step = 0; step < Math.abs(horizontalSteps); step += 1) {
				moveSteps.push(moveOneStep);
			}

			const performStep = (stepIndex: number) => {
				if (!dragActions.isActive()) {
					return;
				}
				try {
					if (stepIndex >= moveSteps.length) {
						dragActions.drop();
						return;
					}
					moveSteps[stepIndex]?.();
					window.setTimeout(() => {
						performStep(stepIndex + 1);
					}, 90);
				} catch {
					clearProgrammaticCardMoveInFlight(taskId);
					if (dragActions.isActive()) {
						dragActions.cancel();
					}
				}
			};

			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => {
					performStep(0);
				});
			});
			return true;
		},
		[
			canAnimateProgrammaticTopInsertion,
			clearProgrammaticCardMoveInFlight,
			getElementClientCenter,
			getProgrammaticTopTargetClientSelection,
			isColumnHidden,
		],
	);

	useEffect(() => {
		onRequestProgrammaticCardMoveReady?.(requestProgrammaticCardMove);
		return () => {
			onRequestProgrammaticCardMoveReady?.(null);
		};
	}, [onRequestProgrammaticCardMoveReady, requestProgrammaticCardMove]);

	const handleBeforeCapture = useCallback(
		(start: BeforeCapture) => {
			setActiveDragTaskId(start.draggableId);
			setActiveDragSourceColumnId(findCardColumnId(data.columns, start.draggableId));
		},
		[data],
	);

	const handleDragStart = useCallback((_start: DragStart) => {
		dragOccurredRef.current = true;
	}, []);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			setActiveDragTaskId(null);
			setActiveDragSourceColumnId(null);
			clearProgrammaticCardMoveInFlight(result.draggableId);
			requestAnimationFrame(() => {
				dragOccurredRef.current = false;
			});
			onDragEnd?.(result);
		},
		[clearProgrammaticCardMoveInFlight, onDragEnd],
	);

	return (
		<DragDropContext
			onBeforeCapture={handleBeforeCapture}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			sensors={[programmaticSensor]}
		>
			<section
				ref={boardRef}
				className="kb-board"
				data-programmatic-card-move={programmaticCardMoveInFlight ? "true" : undefined}
			>
				{data.columns.map((column) =>
					isColumnHidden(column.id) ? (
						<HiddenBoardColumn key={column.id} column={column} onShow={() => showColumn(column.id)} />
					) : (
						<BoardColumn
							key={column.id}
							column={column}
							taskSessions={taskSessions}
							onCreateTask={column.id === "in_progress" ? onCreateTask : undefined}
							onBranchTask={column.id !== "trash" ? onBranchTask : undefined}
							onClearTrash={column.id === "trash" ? onClearTrash : undefined}
							onHide={() => hideColumn(column.id)}
							onMoveToTrashTask={isReviewLikeColumnId(column.id) ? onMoveToTrashTask : undefined}
							onRestoreFromTrashTask={column.id === "trash" ? onRestoreFromTrashTask : undefined}
							moveToTrashLoadingById={isReviewLikeColumnId(column.id) ? moveToTrashLoadingById : undefined}
							activeDragTaskId={activeDragTaskId}
							activeDragSourceColumnId={activeDragSourceColumnId}
							programmaticCardMoveInFlight={programmaticCardMoveInFlight}
							workspacePath={workspacePath}
							isDragDisabled={isDragDisabled}
							hideCardActions={hideCardActions}
							onCardClick={(card) => {
								if (!dragOccurredRef.current) {
									onCardSelect(card.id);
								}
							}}
						/>
					),
				)}
			</section>
		</DragDropContext>
	);
}
