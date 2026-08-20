import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import {
	RESTART_CONTINUATION_PROMPT,
	useResumeInterruptedTaskSessions,
} from "@/hooks/use-resume-interrupted-task-sessions";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";
import type { RuntimeAgentId, RuntimeTaskSessionSummary } from "@/runtime/types";
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
		prompt: title,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		agentId,
		baseRef: "main",
	});
}

function createSummary(
	taskId: string,
	agentId: RuntimeAgentId,
	state: RuntimeTaskSessionSummary["state"] = "interrupted",
): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId,
		workspacePath: `/tmp/${taskId}`,
		pid: null,
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
	board,
	sessions,
	workspaceHydrationNonce,
	startTaskSession,
}: {
	board: BoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	workspaceHydrationNonce: number;
	startTaskSession: UseTaskSessionsResult["startTaskSession"];
}): null {
	useResumeInterruptedTaskSessions({
		board,
		sessions,
		currentProjectId: "workspace-1",
		workspaceHydrationNonce,
		isWorkspaceMetadataPending: false,
		startTaskSession,
	});
	return null;
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

	it("continues interrupted CLI tasks that were already in progress once per hydration", async () => {
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
		const startTaskSession = vi.fn<UseTaskSessionsResult["startTaskSession"]>(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<Harness
					board={doneTask.board}
					sessions={sessions}
					workspaceHydrationNonce={1}
					startTaskSession={startTaskSession}
				/>,
			);
		});

		expect(startTaskSession).toHaveBeenCalledTimes(3);
		expect(startTaskSession).toHaveBeenCalledWith(codexTask.task, {
			resumeExistingSession: "running",
			continuationPrompt: RESTART_CONTINUATION_PROMPT,
		});
		expect(startTaskSession).toHaveBeenCalledWith(reviewTask.task, {
			resumeExistingSession: "awaiting_review",
		});
		expect(startTaskSession).toHaveBeenCalledWith(claudeTask.task, {
			resumeExistingSession: "running",
			continuationPrompt: RESTART_CONTINUATION_PROMPT,
		});

		await act(async () => {
			root.render(
				<Harness
					board={doneTask.board}
					sessions={sessions}
					workspaceHydrationNonce={2}
					startTaskSession={startTaskSession}
				/>,
			);
		});

		expect(startTaskSession).toHaveBeenCalledTimes(3);
		expect(notifyErrorMock).not.toHaveBeenCalled();
	});
});
