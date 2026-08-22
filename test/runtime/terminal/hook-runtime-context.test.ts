import { describe, expect, it } from "vitest";

import {
	createHookRuntimeEnv,
	KANBAN_HOOK_TASK_ID_ENV,
	KANBAN_HOOK_WORKSPACE_ID_ENV,
	KANBAN_TASK_ID_ENV,
	KANBAN_WORKSPACE_ID_ENV,
	parseHookRuntimeContextFromEnv,
	readTaskSessionContextFromEnv,
} from "../../../src/terminal/hook-runtime-context";

describe("hook-runtime-context", () => {
	it("creates expected environment variables", () => {
		const env = createHookRuntimeEnv({
			taskId: "task-1",
			workspaceId: "workspace-1",
		});
		expect(env).toEqual({
			[KANBAN_TASK_ID_ENV]: "task-1",
			[KANBAN_WORKSPACE_ID_ENV]: "workspace-1",
			[KANBAN_HOOK_TASK_ID_ENV]: "task-1",
			[KANBAN_HOOK_WORKSPACE_ID_ENV]: "workspace-1",
		});
	});

	it("reads agent-facing task session variables with legacy hook fallbacks", () => {
		expect(
			readTaskSessionContextFromEnv({
				[KANBAN_TASK_ID_ENV]: "task-current",
				[KANBAN_WORKSPACE_ID_ENV]: "workspace-current",
			}),
		).toEqual({ taskId: "task-current", workspaceId: "workspace-current" });
		expect(
			readTaskSessionContextFromEnv({
				[KANBAN_HOOK_TASK_ID_ENV]: "task-legacy",
				[KANBAN_HOOK_WORKSPACE_ID_ENV]: "workspace-legacy",
			}),
		).toEqual({ taskId: "task-legacy", workspaceId: "workspace-legacy" });
	});

	it("parses hook runtime context from env", () => {
		const parsed = parseHookRuntimeContextFromEnv({
			[KANBAN_HOOK_TASK_ID_ENV]: "task-2",
			[KANBAN_HOOK_WORKSPACE_ID_ENV]: "workspace-2",
		});
		expect(parsed).toEqual({
			taskId: "task-2",
			workspaceId: "workspace-2",
		});
	});

	it("throws when required env vars are missing", () => {
		expect(() => parseHookRuntimeContextFromEnv({})).toThrow(
			`Missing required environment variable: ${KANBAN_HOOK_TASK_ID_ENV}`,
		);
	});
});
