import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { BoardData } from "@/types";

export const TASK_START_IN_PLAN_MODE_STORAGE_KEY = LocalStorageKey.TaskStartInPlanMode;
const DETAIL_TASK_QUERY_PARAM = "task";

export function countTasksByColumn(board: BoardData): {
	backlog: number;
	in_progress: number;
	review: number;
	on_hold: number;
	trash: number;
} {
	const counts = {
		backlog: 0,
		in_progress: 0,
		review: 0,
		on_hold: 0,
		trash: 0,
	};
	for (const column of board.columns) {
		if (column.id === "backlog") {
			counts.backlog += column.cards.length;
			continue;
		}
		if (column.id === "in_progress") {
			counts.in_progress += column.cards.length;
			continue;
		}
		if (column.id === "review") {
			counts.review += column.cards.length;
			continue;
		}
		if (column.id === "on_hold") {
			counts.on_hold += column.cards.length;
			continue;
		}
		if (column.id === "trash") {
			counts.trash += column.cards.length;
		}
	}
	return counts;
}

export function parseProjectIdFromPathname(pathname: string): string | null {
	const segments = pathname.split("/").filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return null;
	}
	const firstSegment = segments[0];
	if (!firstSegment) {
		return null;
	}
	try {
		return decodeURIComponent(firstSegment);
	} catch {
		return null;
	}
}

export function buildProjectPathname(projectId: string): string {
	return `/${encodeURIComponent(projectId)}`;
}

export function parseDetailTaskIdFromSearch(search: string): string | null {
	const params = new URLSearchParams(search);
	const taskId = params.get(DETAIL_TASK_QUERY_PARAM)?.trim();
	return taskId ? taskId : null;
}

export function buildDetailTaskUrl(input: {
	pathname: string;
	search: string;
	hash: string;
	taskId: string | null;
}): string {
	const params = new URLSearchParams(input.search);
	if (input.taskId) {
		params.set(DETAIL_TASK_QUERY_PARAM, input.taskId);
	} else {
		params.delete(DETAIL_TASK_QUERY_PARAM);
	}
	const nextSearch = params.toString();
	return `${input.pathname}${nextSearch ? `?${nextSearch}` : ""}${input.hash}`;
}

export function createIdleTaskSession(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
	};
}
