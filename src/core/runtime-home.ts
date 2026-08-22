import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const KANBAN_RUNTIME_HOME_ENV = "KANBAN_RUNTIME_HOME";

export function getRuntimeHomePath(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): string {
	const override = env[KANBAN_RUNTIME_HOME_ENV]?.trim();
	if (!override) {
		return join(userHome, ".kanban");
	}
	if (override === "~") {
		return userHome;
	}
	if (override.startsWith("~/") || override.startsWith("~\\")) {
		return resolve(userHome, override.slice(2));
	}
	return resolve(override);
}
