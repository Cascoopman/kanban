import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import {
	RESTART_CONTINUATION_PROMPT,
	useResumeInterruptedTaskSessions,
} from "@/hooks/use-resume-interrupted-task-sessions";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";
import type { RuntimeAgentId, RuntimeProjectBoardSnapshot, RuntimeTaskSessionSummary } from "@/runtime/types";
import { addTaskToColumnWithResult } from "@/state/board-state";
import type { BoardData } from "@/types";

const notifyErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/app-toaster", () => ({
	notifyError: notifyErrorMock,
}));

function createTask(
	board: BoardData,
	columnId: "in_progress" | "review" | "on_hold" | "trash",
	title: string,
	agentId: RuntimeAgentId,
) {
	return addTaskToColumnWithResult(board, columnId, {
		title,
		startInPlanMode: false,
		agentId,
		baseRef: "main",
	});
}

function createSummary(
	taskId: string,
	agentId: RuntimeAgentId,
	state: RuntimeTaskSessionSummary["state"] = "interrupted",
	pid: number | null = null,
): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId,
		workspacePath: `/tmp/${taskId}`,
		pid,
		startedAt: 1,
		updatedAt: 2,
		lastOutputAt: 1,
		reviewReason: state === "interrupted" ? "interrupted" : null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

function Harness({
	projectBoards,
	hasReceivedSnapshot = true,
	isRuntimeDisconnected = false,
	startTaskSessionForProject,
}: {
	projectBoards: RuntimeProjectBoardSnapshot[];
	hasReceivedSnapshot?: boolean;
	isRuntimeDisconnected?: boolean;
	startTaskSessionForProject: UseTaskSessionsResult["startTaskSessionForProject"];
}): null {
	useResumeInterruptedTaskSessions({
		projectBoards,
		hasReceivedSnapshot,
		isRuntimeDisconnected,
		startTaskSessionForProject,
	});
	return null;
}

function createProjectSnapshot(
	projectId: string,
	board: BoardData,
	sessions: Record<string, RuntimeTaskSessionSummary>,
): RuntimeProjectBoardSnapshot {
	return {
		project: {
			id: projectId,
			path: `/tmp/${projectId}`,
			name: projectId,
			taskCounts: {
				in_progress: board.columns.find((column) => column.id === "in_progress")?.cards.length ?? 0,
				review: board.columns.find((column) => column.id === "review")?.cards.length ?? 0,
				on_hold: board.columns.find((column) => column.id === "on_hold")?.cards.length ?? 0,
				trash: board.columns.find((column) => column.id === "trash")?.cards.length ?? 0,
			},
		},
		board,
		sessions,
	};
}

describe("useResumeInterruptedTaskSessions", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		notifyErrorMock.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("continues interrupted CLI tasks once per loaded project task", async () => {
		const codexTask = createTask(createInitialBoardData(), "in_progress", "Codex task", "codex");
		const claudeTask = createTask(codexTask.board, "in_progress", "Claude task", "claude");
		const reviewTask = createTask(claudeTask.board, "review", "Review task", "codex");
		const onHoldTask = createTask(reviewTask.board, "on_hold", "On hold task", "codex");
		const doneTask = createTask(onHoldTask.board, "trash", "Done task", "codex");
		const sessions = {
			[codexTask.task.id]: createSummary(codexTask.task.id, "codex"),
			[claudeTask.task.id]: createSummary(claudeTask.task.id, "claude"),
			[reviewTask.task.id]: createSummary(reviewTask.task.id, "codex", "awaiting_review"),
			[onHoldTask.task.id]: createSummary(onHoldTask.task.id, "codex", "awaiting_review"),
			[doneTask.task.id]: createSummary(doneTask.task.id, "codex"),
		};
		const startTaskSessionForProject = vi.fn<UseTaskSessionsResult["startTaskSessionForProject"]>(async () => ({
			ok: true as const,
		}));
		const projectBoards = [createProjectSnapshot("workspace-1", doneTask.board, sessions)];

		await act(async () => {
			root.render(<Harness projectBoards={projectBoards} startTaskSessionForProject={startTaskSessionForProject} />);
		});

		expect(startTaskSessionForProject).toHaveBeenCalledTimes(3);
		expect(startTaskSessionForProject).toHaveBeenCalledWith("workspace-1", codexTask.task, {
			resumeExistingSession: "running",
			continuationPrompt: RESTART_CONTINUATION_PROMPT,
		});
		expect(startTaskSessionForProject).toHaveBeenCalledWith("workspace-1", reviewTask.task, {
			resumeExistingSession: "awaiting_review",
		});
		expect(startTaskSessionForProject).toHaveBeenCalledWith("workspace-1", claudeTask.task, {
			resumeExistingSession: "running",
			continuationPrompt: RESTART_CONTINUATION_PROMPT,
		});

		await act(async () => {
			root.render(
				<Harness projectBoards={[...projectBoards]} startTaskSessionForProject={startTaskSessionForProject} />,
			);
		});

		expect(startTaskSessionForProject).toHaveBeenCalledTimes(3);
		expect(notifyErrorMock).not.toHaveBeenCalled();
	});

	it("resumes interrupted tasks from every loaded project", async () => {
		const projectATask = createTask(createInitialBoardData(), "in_progress", "Project A task", "codex");
		const projectBTask = createTask(createInitialBoardData(), "in_progress", "Project B task", "claude");
		const projectBoards = [
			createProjectSnapshot("workspace-a", projectATask.board, {
				[projectATask.task.id]: createSummary(projectATask.task.id, "codex"),
			}),
			createProjectSnapshot("workspace-b", projectBTask.board, {
				[projectBTask.task.id]: createSummary(projectBTask.task.id, "claude"),
			}),
		];
		const startTaskSessionForProject = vi.fn<UseTaskSessionsResult["startTaskSessionForProject"]>(async () => ({
			ok: true as const,
		}));

		await act(async () => {
			root.render(<Harness projectBoards={projectBoards} startTaskSessionForProject={startTaskSessionForProject} />);
		});

		expect(startTaskSessionForProject).toHaveBeenCalledTimes(2);
		expect(startTaskSessionForProject).toHaveBeenCalledWith("workspace-a", projectATask.task, {
			resumeExistingSession: "running",
			continuationPrompt: RESTART_CONTINUATION_PROMPT,
		});
		expect(startTaskSessionForProject).toHaveBeenCalledWith("workspace-b", projectBTask.task, {
			resumeExistingSession: "running",
			continuationPrompt: RESTART_CONTINUATION_PROMPT,
		});
	});

	it("resumes a task again after a later runtime restart", async () => {
		const task = createTask(createInitialBoardData(), "in_progress", "Restarted task", "codex");
		const interrupted = createSummary(task.task.id, "codex");
		const startTaskSessionForProject = vi.fn<UseTaskSessionsResult["startTaskSessionForProject"]>(async () => ({
			ok: true as const,
		}));

		await act(async () => {
			root.render(
				<Harness
					projectBoards={[createProjectSnapshot("workspace-1", task.board, { [task.task.id]: interrupted })]}
					startTaskSessionForProject={startTaskSessionForProject}
				/>,
			);
		});
		expect(startTaskSessionForProject).toHaveBeenCalledTimes(1);

		const running = {
			...interrupted,
			state: "running" as const,
			pid: 123,
			updatedAt: 3,
			reviewReason: null,
		};
		await act(async () => {
			root.render(
				<Harness
					projectBoards={[createProjectSnapshot("workspace-1", task.board, { [task.task.id]: running })]}
					startTaskSessionForProject={startTaskSessionForProject}
				/>,
			);
		});
		expect(startTaskSessionForProject).toHaveBeenCalledTimes(1);

		await act(async () => {
			root.render(
				<Harness
					projectBoards={[createProjectSnapshot("workspace-1", task.board, { [task.task.id]: running })]}
					isRuntimeDisconnected
					startTaskSessionForProject={startTaskSessionForProject}
				/>,
			);
		});
		expect(startTaskSessionForProject).toHaveBeenCalledTimes(1);

		const interruptedAgain = {
			...running,
			state: "interrupted" as const,
			pid: null,
			updatedAt: 4,
			reviewReason: "interrupted" as const,
		};
		await act(async () => {
			root.render(
				<Harness
					projectBoards={[createProjectSnapshot("workspace-1", task.board, { [task.task.id]: interruptedAgain })]}
					startTaskSessionForProject={startTaskSessionForProject}
				/>,
			);
		});

		expect(startTaskSessionForProject).toHaveBeenCalledTimes(2);
		expect(startTaskSessionForProject).toHaveBeenLastCalledWith("workspace-1", task.task, {
			resumeExistingSession: "running",
			continuationPrompt: RESTART_CONTINUATION_PROMPT,
		});
	});
});
