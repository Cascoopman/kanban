import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const KANBAN_RUNTIME_HOME_ENV = "KANBAN_RUNTIME_HOME";

export function getRuntimeHomePath(env: NodeJS.ProcessEnv = process.env): string {
	const override = env[KANBAN_RUNTIME_HOME_ENV]?.trim();
	return override ? resolve(override) : join(homedir(), ".kanban");
}
