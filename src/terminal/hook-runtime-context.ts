export const KANBAN_TASK_ID_ENV = "KANBAN_TASK_ID";
export const KANBAN_WORKSPACE_ID_ENV = "KANBAN_WORKSPACE_ID";
export const KANBAN_HOOK_TASK_ID_ENV = "KANBAN_HOOK_TASK_ID";
export const KANBAN_HOOK_WORKSPACE_ID_ENV = "KANBAN_HOOK_WORKSPACE_ID";

export interface HookRuntimeContext {
	taskId: string;
	workspaceId: string;
}

function requireTrimmedEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
}

export function createHookRuntimeEnv(context: HookRuntimeContext): Record<string, string> {
	return {
		[KANBAN_TASK_ID_ENV]: context.taskId,
		[KANBAN_WORKSPACE_ID_ENV]: context.workspaceId,
		[KANBAN_HOOK_TASK_ID_ENV]: context.taskId,
		[KANBAN_HOOK_WORKSPACE_ID_ENV]: context.workspaceId,
	};
}

export function readTaskSessionContextFromEnv(env: NodeJS.ProcessEnv = process.env): {
	taskId: string | null;
	workspaceId: string | null;
} {
	return {
		taskId: env[KANBAN_TASK_ID_ENV]?.trim() || env[KANBAN_HOOK_TASK_ID_ENV]?.trim() || null,
		workspaceId: env[KANBAN_WORKSPACE_ID_ENV]?.trim() || env[KANBAN_HOOK_WORKSPACE_ID_ENV]?.trim() || null,
	};
}

export function parseHookRuntimeContextFromEnv(env: NodeJS.ProcessEnv = process.env): HookRuntimeContext {
	const taskId = requireTrimmedEnv(env, KANBAN_HOOK_TASK_ID_ENV);
	const workspaceId = requireTrimmedEnv(env, KANBAN_HOOK_WORKSPACE_ID_ENV);
	return {
		taskId,
		workspaceId,
	};
}
