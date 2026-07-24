import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanBoard, type RequestProgrammaticCardMove } from "@/components/kanban-board";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { BoardData } from "@/types";

const dndMock = vi.hoisted(() => ({
	sensorApi: null as {
		tryGetLock: ReturnType<typeof vi.fn>;
	} | null,
}));

vi.mock("@hello-pangea/dnd", async () => {
	const React = await vi.importActual<typeof import("react")>("react");

	return {
		DragDropContext: ({
			children,
			sensors,
		}: {
			children: ReactNode;
			sensors?: Array<(api: NonNullable<typeof dndMock.sensorApi>) => void>;
		}): React.ReactElement => {
			React.useEffect(() => {
				if (!dndMock.sensorApi) {
					return;
				}
				for (const sensor of sensors ?? []) {
					sensor(dndMock.sensorApi);
				}
			}, [sensors]);

			return <>{children}</>;
		},
	};
});

vi.mock("@/components/board-column", () => ({
	BoardColumn: ({
		column,
		onHide,
	}: {
		column: BoardData["columns"][number];
		onHide?: () => void;
	}): React.ReactElement => (
		<section data-column-id={column.id}>
			<button type="button" aria-label={`Hide ${column.title} column`} onClick={onHide} />
			<div className="kb-column-cards">
				{column.cards.map((card) => (
					<div key={card.id} data-task-id={card.id} />
				))}
			</div>
		</section>
	),
}));

vi.mock("@/components/dependencies/dependency-overlay", () => ({
	DependencyOverlay: (): null => null,
}));

vi.mock("@/components/dependencies/use-dependency-linking", () => ({
	useDependencyLinking: () => ({
		draft: null,
		onDependencyPointerDown: vi.fn(),
		onDependencyPointerEnter: vi.fn(),
	}),
}));

function createRect(left: number, top: number, width: number, height: number): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

describe("KanbanBoard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		window.localStorage.clear();
		vi.useFakeTimers();
		vi.spyOn(performance, "now").mockImplementation(() => Date.now());
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
			return window.setTimeout(() => {
				callback(performance.now());
			}, 16);
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number) => {
			window.clearTimeout(handle);
		});
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
			this: HTMLElement,
		) {
			if (this.dataset.taskId === "source-task") {
				return createRect(20, 20, 160, 96);
			}
			if (this.dataset.taskId === "target-task-1") {
				return createRect(300, 20, 160, 96);
			}
			if (this.classList.contains("kb-column-cards")) {
				const columnId = this.closest<HTMLElement>("[data-column-id]")?.dataset.columnId;
				if (columnId === "backlog") {
					return createRect(12, 12, 176, 420);
				}
				if (columnId === "in_progress") {
					return createRect(292, 12, 176, 420);
				}
			}
			return createRect(0, 0, 0, 0);
		});
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		dndMock.sensorApi = null;
		vi.restoreAllMocks();
		vi.useRealTimers();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("marks the board while a programmatic move is active", async () => {
		const dragActions = {
			isActive: vi.fn(() => true),
			move: vi.fn(),
			drop: vi.fn(),
			cancel: vi.fn(),
		};
		const preDrag = {
			fluidLift: vi.fn(() => dragActions),
			isActive: vi.fn(() => true),
			abort: vi.fn(),
		};
		dndMock.sensorApi = {
			tryGetLock: vi.fn(() => preDrag),
		};

		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "source-task",
							title: "Source task",
							prompt: "Source task",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: "target-task-1",
							title: "Target task 1",
							prompt: "Target task 1",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		let requestMove: RequestProgrammaticCardMove | null = null;

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
					onRequestProgrammaticCardMoveReady={(nextRequestMove) => {
						requestMove = nextRequestMove;
					}}
				/>,
			);
		});

		const boardElement = container.querySelector<HTMLElement>(".kb-board");
		expect(boardElement?.dataset.programmaticCardMove).toBeUndefined();

		await act(async () => {
			requestMove?.({
				taskId: "source-task",
				fromColumnId: "backlog",
				toColumnId: "in_progress",
				insertAtTop: true,
			});
		});

		expect(boardElement?.dataset.programmaticCardMove).toBe("true");
	});

	it("hides and restores any combination of columns while persisting the layout preference", async () => {
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "on_hold", title: "On Hold", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});

		const hideDoneButton = container.querySelector<HTMLButtonElement>('button[aria-label="Hide Done column"]');
		expect(hideDoneButton).not.toBeNull();

		await act(async () => {
			hideDoneButton?.click();
		});

		expect(container.querySelector('[data-column-id="trash"]')).toBeNull();
		expect(container.querySelector('button[aria-label="Show Done column"]')).not.toBeNull();
		expect(window.localStorage.getItem(LocalStorageKey.BoardHiddenColumns)).toBe("trash");

		await act(async () => {
			container.querySelector<HTMLButtonElement>('button[aria-label="Hide Review column"]')?.click();
		});

		expect(container.querySelector('[data-column-id="review"]')).toBeNull();
		expect(container.querySelector('[data-column-id="trash"]')).toBeNull();
		expect(window.localStorage.getItem(LocalStorageKey.BoardHiddenColumns)).toBe("review,trash");

		await act(async () => {
			container.querySelector<HTMLButtonElement>('button[aria-label="Show Done column"]')?.click();
		});

		expect(container.querySelector('[data-column-id="trash"]')).not.toBeNull();
		expect(container.querySelector('[data-column-id="review"]')).toBeNull();
		expect(window.localStorage.getItem(LocalStorageKey.BoardHiddenColumns)).toBe("review");

		await act(async () => {
			container.querySelector<HTMLButtonElement>('button[aria-label="Show Review column"]')?.click();
		});

		expect(container.querySelector('[data-column-id="review"]')).not.toBeNull();
		expect(window.localStorage.getItem(LocalStorageKey.BoardHiddenColumns)).toBe("");
	});

	it("skips programmatic animation when a move targets a hidden column", async () => {
		window.localStorage.setItem(LocalStorageKey.BoardHiddenColumns, "in_progress");
		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "source-task",
							title: "Source task",
							prompt: "Source task",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "in_progress", title: "In Progress", cards: [] },
			],
			dependencies: [],
		};
		let requestMove: RequestProgrammaticCardMove | null = null;

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
					onRequestProgrammaticCardMoveReady={(nextRequestMove) => {
						requestMove = nextRequestMove;
					}}
				/>,
			);
		});

		let started = true;
		await act(async () => {
			started =
				requestMove?.({
					taskId: "source-task",
					fromColumnId: "backlog",
					toColumnId: "in_progress",
					insertAtTop: true,
				}) ?? false;
		});

		expect(started).toBe(false);
		expect(container.querySelector<HTMLElement>(".kb-board")?.dataset.programmaticCardMove).toBeUndefined();
	});

	it("counts only visible columns during programmatic horizontal moves", async () => {
		window.localStorage.setItem(LocalStorageKey.BoardHiddenColumns, "review,on_hold");
		const dragActions = {
			isActive: vi.fn(() => true),
			moveRight: vi.fn(),
			moveLeft: vi.fn(),
			drop: vi.fn(),
			cancel: vi.fn(),
		};
		const preDrag = {
			snapLift: vi.fn(() => dragActions),
			isActive: vi.fn(() => true),
			abort: vi.fn(),
		};
		dndMock.sensorApi = {
			tryGetLock: vi.fn(() => preDrag),
		};
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: "source-task",
							title: "Source task",
							prompt: "Source task",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "review", title: "Review", cards: [] },
				{ id: "on_hold", title: "On Hold", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		let requestMove: RequestProgrammaticCardMove | null = null;

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
					onRequestProgrammaticCardMoveReady={(nextRequestMove) => {
						requestMove = nextRequestMove;
					}}
				/>,
			);
		});

		await act(async () => {
			requestMove?.({
				taskId: "source-task",
				fromColumnId: "in_progress",
				toColumnId: "trash",
				insertAtTop: false,
			});
			vi.runAllTimers();
		});

		expect(dragActions.moveRight).toHaveBeenCalledTimes(1);
		expect(dragActions.drop).toHaveBeenCalledTimes(1);
	});
});
