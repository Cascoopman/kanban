import { describe, expect, it } from "vitest";

import { buildUnifiedProjectBoard } from "@/hooks/use-project-boards";
import type { RuntimeProjectBoardSnapshot } from "@/runtime/types";

function createSnapshot(projectId: string, taskId: string): RuntimeProjectBoardSnapshot {
	return {
		project: {
			id: projectId,
			name: projectId,
			path: `/repos/${projectId}`,
			taskCounts: { in_progress: 1, review: 0, on_hold: 0, trash: 0 },
		},
		board: {
			columns: [
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: taskId,
							title: taskId,
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
		},
		sessions: {},
	};
}

describe("buildUnifiedProjectBoard", () => {
	it("combines visible projects into the four-column board", () => {
		const result = buildUnifiedProjectBoard(
			[createSnapshot("a", "task-a"), createSnapshot("b", "task-b")],
			new Set(["a", "b"]),
		);

		expect(result.board.columns.map((column) => column.id)).toEqual(["in_progress", "review", "on_hold", "trash"]);
		expect(result.board.columns[0]?.cards.map((card) => card.id)).toEqual(["task-a", "task-b"]);
	});
});
