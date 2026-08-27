import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface AgentInstructionsFile {
	path: string;
	content: string;
	exists: boolean;
}

export const AGENT_INSTRUCTIONS_FILENAME = "AGENTS.md";

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function getAgentInstructionsPath(workspacePath: string): string {
	return join(workspacePath, AGENT_INSTRUCTIONS_FILENAME);
}

async function loadAgentInstructionsPath(path: string): Promise<AgentInstructionsFile> {
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

export async function loadAgentInstructionsFile(workspacePath: string): Promise<AgentInstructionsFile> {
	return await loadAgentInstructionsPath(getAgentInstructionsPath(workspacePath));
}
