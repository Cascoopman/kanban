import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RuntimeAgentInstructionsResponse } from "../core/api-contract";
import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state";

export const AGENT_INSTRUCTIONS_FILENAME = "AGENTS.md";

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function getAgentInstructionsPath(workspacePath: string): string {
	return join(workspacePath, AGENT_INSTRUCTIONS_FILENAME);
}

export function getGlobalAgentInstructionsPath(): string {
	return join(getRuntimeHomePath(), AGENT_INSTRUCTIONS_FILENAME);
}

async function loadAgentInstructionsPath(path: string): Promise<RuntimeAgentInstructionsResponse> {
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

export async function loadAgentInstructionsFile(workspacePath: string): Promise<RuntimeAgentInstructionsResponse> {
	return await loadAgentInstructionsPath(getAgentInstructionsPath(workspacePath));
}

export async function loadGlobalAgentInstructionsFile(): Promise<RuntimeAgentInstructionsResponse> {
	return await loadAgentInstructionsPath(getGlobalAgentInstructionsPath());
}

async function saveAgentInstructionsPath(path: string, content: string): Promise<RuntimeAgentInstructionsResponse> {
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

export async function saveGlobalAgentInstructionsFile(content: string): Promise<RuntimeAgentInstructionsResponse> {
	return await saveAgentInstructionsPath(getGlobalAgentInstructionsPath(), content);
}
