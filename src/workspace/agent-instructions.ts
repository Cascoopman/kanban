import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RuntimeAgentInstructionsResponse } from "../core/api-contract";
import { lockedFileSystem } from "../fs/locked-file-system";

export const AGENT_INSTRUCTIONS_FILENAME = "AGENTS.md";

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function getAgentInstructionsPath(workspacePath: string): string {
	return join(workspacePath, AGENT_INSTRUCTIONS_FILENAME);
}

export async function loadAgentInstructionsFile(workspacePath: string): Promise<RuntimeAgentInstructionsResponse> {
	const path = getAgentInstructionsPath(workspacePath);
	try {
		return {
			path,
			content: await readFile(path, "utf8"),
			exists: true,
		};
	} catch (error) {
		if (isMissingFileError(error)) {
			return { path, content: "", exists: false };
		}
		throw error;
	}
}

export async function saveAgentInstructionsFile(
	workspacePath: string,
	content: string,
): Promise<RuntimeAgentInstructionsResponse> {
	const path = getAgentInstructionsPath(workspacePath);
	let isSymbolicLink = false;
	try {
		isSymbolicLink = (await lstat(path)).isSymbolicLink();
	} catch (error) {
		if (!isMissingFileError(error)) {
			throw error;
		}
	}

	if (isSymbolicLink) {
		await lockedFileSystem.withLock({ path }, async () => {
			await writeFile(path, content, "utf8");
		});
	} else {
		await lockedFileSystem.writeTextFileAtomic(path, content);
	}

	return { path, content, exists: true };
}
