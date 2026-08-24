import { act, type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBoardInteractions } from "@/hooks/use-board-interactions";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardData } from "@/types";

const notifyErrorMock = vi.hoisted(() => vi.fn());
const showAppToastMock = vi.hoisted(() => vi.fn());
const useProgrammaticCardMovesMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/app-toaster", () => ({
	notifyError: notifyErrorMock,
	showAppToast: showAppToastMock,
}));

vi.mock("@/hooks/use-programmatic-card-moves", () => ({
	useProgrammaticCardMoves: useProgrammaticCardMovesMock,
}));

function createTask(taskId: string, title: string, createdAt: number): BoardCard {
	return {
		id: taskId,
		title,
		startInPlanMode: false,
		baseRef: "main",
		createdAt,
		updatedAt: createdAt,
	};
}

function createBoard({ inProgress = [], trash = [] }: { inProgress?: BoardCard[]; trash?: BoardCard[] }): BoardData {
	return {
		columns: [
			{ id: "in_progress", title: "In Progress", cards: inProgress },
			{ id: "review", title: "Review", cards: [] },
			{ id: "on_hold", title: "On Hold", cards: [] },
			{ id: "trash", title: "Done", cards: trash },
		],
		dependencies: [],
	};
}

const NOOP_STOP_SESSION = async (): Promise<void> => {};
const NOOP_CLEANUP_WORKSPACE = async (): Promise<null> => null;
const NOOP_FETCH_WORKSPACE_INFO = async (): Promise<null> => null;

interface HookSnapshot {
	handleMoveCardToTrash: (taskId: string) => void;
	handleRestoreTaskFromTrash: (taskId: string) => void;
	handleStartTask: (taskId: string) => void;
	handleCardSelect: (taskId: string) => void;
	handleConfirmClearTrash: () => void;
}

function HookHarness({
	board,
	setBoard,
	ensureTaskWorkspace,
	startTaskSession,
	stopTaskSession = NOOP_STOP_SESSION,
	cleanupTaskWorkspace = NOOP_CLEANUP_WORKSPACE,
	setSelectedTaskIdOverride,
	onSnapshot,
}: {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	ensureTaskWorkspace: UseTaskSessionsResult["ensureTaskWorkspace"];
	startTaskSession: UseTaskSessionsResult["startTaskSession"];
	stopTaskSession?: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace?: (taskId: string) => Promise<unknown>;
	setSelectedTaskIdOverride?: Dispatch<SetStateAction<string | null>>;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const [, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [, setSelectedTaskId] = useState<string | null>(null);
	const [, setIsClearTrashDialogOpen] = useState(false);
	const actions = useBoardInteractions({
		board,
		setBoard,
		setSessions,
		selectedTaskId: null,
		currentProjectId: "project-1",
		setSelectedTaskId: setSelectedTaskIdOverride ?? setSelectedTaskId,
		setIsClearTrashDialogOpen,
		stopTaskSession,
		cleanupTaskWorkspace,
		ensureTaskWorkspace,
		startTaskSession,
		fetchTaskWorkspaceInfo: NOOP_FETCH_WORKSPACE_INFO,
		readyForReviewNotificationsEnabled: false,
	});

	useEffect(() => {
		onSnapshot({
			handleMoveCardToTrash: actions.handleMoveCardToTrash,
			handleRestoreTaskFromTrash: actions.handleRestoreTaskFromTrash,
			handleStartTask: actions.handleStartTask,
			handleCardSelect: actions.handleCardSelect,
			handleConfirmClearTrash: actions.handleConfirmClearTrash,
		});
	}, [
		actions.handleCardSelect,
		actions.handleConfirmClearTrash,
		actions.handleMoveCardToTrash,
		actions.handleRestoreTaskFromTrash,
		actions.handleStartTask,
		onSnapshot,
	]);

	return null;
}

describe("useBoardInteractions", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		notifyErrorMock.mockReset();
		showAppToastMock.mockReset();
		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("starts an in-progress task directly", async () => {
		const task = createTask("task-1", "New task", 1);
		const board = createBoard({ inProgress: [task] });
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));
		let snapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={() => board}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(next) => {
						snapshot = next;
					}}
				/>,
			);
		});
		await act(async () => {
			snapshot?.handleStartTask(task.id);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(ensureTaskWorkspace).toHaveBeenCalledWith(task);
		expect(startTaskSession).toHaveBeenCalledWith(task);
	});

	it("moves an in-progress card to done using its actual source column", async () => {
		const task = createTask("task-1", "Active task", 1);
		const board = createBoard({ inProgress: [task] });
		const requestMoveTaskToTrashWithAnimation = vi.fn(async () => {});
		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation,
		});
		let snapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={() => board}
					ensureTaskWorkspace={async () => ({ ok: true as const })}
					startTaskSession={async () => ({ ok: true as const })}
					onSnapshot={(next) => {
						snapshot = next;
					}}
				/>,
			);
		});
		await act(async () => {
			snapshot?.handleMoveCardToTrash(task.id);
			await Promise.resolve();
		});

		expect(requestMoveTaskToTrashWithAnimation).toHaveBeenCalledWith(task.id, "in_progress");
	});

	it("shows a warning when restoring a task whose saved patch cannot be fully reapplied", async () => {
		const task = createTask("task-trash", "Done task", 2);
		const board = createBoard({ trash: [task] });
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-trash",
				baseRef: "main",
				baseCommit: "abc123",
				warning: "Saved task changes could not be reapplied automatically.",
			},
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));
		let snapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={() => board}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(next) => {
						snapshot = next;
					}}
				/>,
			);
		});
		await act(async () => {
			snapshot?.handleRestoreTaskFromTrash(task.id);
			for (let index = 0; index < 10; index += 1) await Promise.resolve();
		});

		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: task.id }), {
			resumeFromTrash: true,
		});
		expect(showAppToastMock).toHaveBeenCalledWith({
			intent: "warning",
			icon: "warning-sign",
			message: "Saved task changes could not be reapplied automatically.",
			timeout: 7000,
		});
	});

	it("ignores card selection requests for trashed tasks", async () => {
		const task = createTask("task-trash", "Done task", 2);
		const board = createBoard({ trash: [task] });
		const setSelectedTaskId = vi.fn<Dispatch<SetStateAction<string | null>>>();
		let snapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={() => board}
					ensureTaskWorkspace={async () => ({ ok: true as const })}
					startTaskSession={async () => ({ ok: true as const })}
					setSelectedTaskIdOverride={setSelectedTaskId}
					onSnapshot={(next) => {
						snapshot = next;
					}}
				/>,
			);
		});
		act(() => snapshot?.handleCardSelect(task.id));

		expect(setSelectedTaskId).not.toHaveBeenCalled();
	});

	it("bounds clear-trash cleanup concurrency while cleaning every task", async () => {
		const trashTasks = Array.from({ length: 25 }, (_, index) =>
			createTask(`task-trash-${index}`, `Done task ${index}`, index + 1),
		);
		const board = createBoard({ trash: trashTasks });
		let inFlight = 0;
		let maxInFlight = 0;
		const stopTaskSession = vi.fn(async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await Promise.resolve();
		});
		const cleanupTaskWorkspace = vi.fn(async () => {
			await Promise.resolve();
			inFlight -= 1;
			return null;
		});
		let snapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={() => board}
					ensureTaskWorkspace={async () => ({ ok: true as const })}
					startTaskSession={async () => ({ ok: true as const })}
					stopTaskSession={stopTaskSession}
					cleanupTaskWorkspace={cleanupTaskWorkspace}
					onSnapshot={(next) => {
						snapshot = next;
					}}
				/>,
			);
		});
		await act(async () => {
			snapshot?.handleConfirmClearTrash();
			for (let index = 0; index < 30; index += 1) await Promise.resolve();
		});

		expect(stopTaskSession).toHaveBeenCalledTimes(trashTasks.length);
		expect(cleanupTaskWorkspace).toHaveBeenCalledTimes(trashTasks.length);
		expect(maxInFlight).toBeGreaterThan(0);
		expect(maxInFlight).toBeLessThanOrEqual(4);
	});
});
