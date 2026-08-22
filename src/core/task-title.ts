export const DEFAULT_TASK_TITLE_MAX_CHARS = 80;

function normalizeTaskTitleWhitespace(value: string): string {
	return value.replaceAll(/\s+/g, " ").trim();
}

function truncateTaskTitle(value: string, maxChars: number): string {
	if (maxChars <= 0) {
		return "";
	}
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars).trimEnd()}…`;
}

export function deriveTaskTitleFromPrompt(prompt: string, maxChars = DEFAULT_TASK_TITLE_MAX_CHARS): string {
	const firstNonEmptyLine =
		prompt
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? "";
	const strippedLine = firstNonEmptyLine
		.replace(/^<[^>]+>/u, "")
		.replace(/<\/[^>]+>$/u, "")
		.trim();
	const normalizedLine = normalizeTaskTitleWhitespace(strippedLine);
	if (!normalizedLine) {
		return "";
	}
	const firstSentenceMatch = normalizedLine.match(/^(.+?[.!?])(?:\s|$)/u);
	return truncateTaskTitle(firstSentenceMatch?.[1] ?? normalizedLine, maxChars);
}
