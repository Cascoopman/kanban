const GET_AGENT_INSTRUCTIONS_PROCEDURE = "runtime.getAgentInstructions";

export function formatAgentInstructionsLoadError(error: Error): string {
	if (error.message.includes("No procedure found") && error.message.includes(GET_AGENT_INSTRUCTIONS_PROCEDURE)) {
		return "The Kanban interface is newer than the running runtime. Restart Kanban to load the AGENTS.md editor.";
	}
	return error.message;
}
