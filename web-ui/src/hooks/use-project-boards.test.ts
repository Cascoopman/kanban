import { describe, expect, it } from "vitest";

import { buildUnifiedProjectBoard, createProjectBoardMove, scopeProjectBoardMove } from "@/hooks/use-project-boards";
import type { RuntimeProjectBoardSnapshot } from "@/runtime/types";

function createSnapshot(input: {
	projectId: string;
	projectName: string;
	taskId: string;
	columnId: "backlog" | "in_progress";
}): RuntimeProjectBoardSnapshot {
	const now = 1_700_000_000_000;
	return {
		project: {
			id: input.projectId,
			name: input.projectName,
			path: `/repos/${input.projectName}`,
			taskCounts: {
				backlog: input.columnId === "backlog" ? 1 : 0,
				in_progress: input.columnId === "in_progress" ? 1 : 0,
				review: 0,
				on_hold: 0,
				trash: 0,
			},
		},
		board: {
			columns: (["backlog", "in_progress", "review", "on_hold", "trash"] as const).map((columnId) => ({
				id: columnId,
				title:
					columnId === "in_progress"
						? "In Progress"
						: columnId === "on_hold"
							? "On Hold"
							: columnId === "trash"
								? "Done"
								: columnId.charAt(0).toUpperCase() + columnId.slice(1),
				cards:
					columnId === input.columnId
						? [
								{
									id: input.taskId,
									title: `${input.projectName} task`,
									prompt: "Do the work",
									startInPlanMode: false,
									baseRef: "main",
									createdAt: now,
									updatedAt: now,
								},
							]
						: [],
			})),
			dependencies: [],
		},
		sessions: {
			[input.taskId]: {
				taskId: input.taskId,
				state: "idle",
				agentId: null,
				workspacePath: null,
				pid: null,
				startedAt: null,
				updatedAt: now,
				lastOutputAt: null,
				reviewReason: null,
				exitCode: null,
				lastHookAt: null,
				latestHookActivity: null,
			},
		},
	};
}

describe("buildUnifiedProjectBoard", () => {
	it("merges cards and sessions while retaining project identity", () => {
		const first = createSnapshot({
			projectId: "project-a",
			projectName: "alpha",
			taskId: "task-a",
			columnId: "backlog",
		});
		const second = createSnapshot({
			projectId: "project-b",
			projectName: "beta",
			taskId: "task-b",
			columnId: "in_progress",
		});

		const result = buildUnifiedProjectBoard([first, second], new Set(["project-a", "project-b"]));

		expect(result.board.columns.find((column) => column.id === "backlog")?.cards[0]).toMatchObject({
			id: "task-a",
			projectId: "project-a",
			projectName: "alpha",
			projectPath: "/repos/alpha",
		});
		expect(result.board.columns.find((column) => column.id === "in_progress")?.cards[0]).toMatchObject({
			id: "task-b",
			projectId: "project-b",
		});
		expect(Object.keys(result.sessions)).toEqual(["task-a", "task-b"]);
	});

	it("filters whole projects without changing the standard column layout", () => {
		const first = createSnapshot({
			projectId: "project-a",
			projectName: "alpha",
			taskId: "task-a",
			columnId: "backlog",
		});
		const second = createSnapshot({
			projectId: "project-b",
			projectName: "beta",
			taskId: "task-b",
			columnId: "in_progress",
		});

		const result = buildUnifiedProjectBoard([first, second], new Set(["project-b"]));

		expect(result.board.columns.map((column) => column.id)).toEqual([
			"backlog",
			"in_progress",
			"review",
			"on_hold",
			"trash",
		]);
		expect(result.board.columns.flatMap((column) => column.cards).map((card) => card.id)).toEqual(["task-b"]);
		expect(Object.keys(result.sessions)).toEqual(["task-b"]);
	});

	it("translates a unified drag back to the owning project's indexes", () => {
		const first = createSnapshot({
			projectId: "project-a",
			projectName: "alpha",
			taskId: "task-a",
			columnId: "backlog",
		});
		const second = createSnapshot({
			projectId: "project-b",
			projectName: "beta",
			taskId: "task-b",
			columnId: "backlog",
		});
		const unified = buildUnifiedProjectBoard([first, second], new Set(["project-a", "project-b"]));
		const move = createProjectBoardMove(unified.board, {
			draggableId: "task-b",
			type: "CARD",
			source: { droppableId: "backlog", index: 1 },
			destination: { droppableId: "in_progress", index: 0 },
			reason: "DROP",
			mode: "FLUID",
			combine: null,
		});

		expect(move).toMatchObject({
			projectId: "project-b",
			taskId: "task-b",
			sourceColumnId: "backlog",
			destinationColumnId: "in_progress",
			destinationIndex: 0,
		});
		if (!move) {
			throw new Error("Expected a project-scoped move.");
		}
		const scoped = scopeProjectBoardMove(second.board, move);
		expect(scoped?.source).toEqual({ droppableId: "backlog", index: 0 });
		expect(scoped?.destination).toEqual({ droppableId: "in_progress", index: 0 });
	});
});
