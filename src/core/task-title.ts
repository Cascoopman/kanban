export const DEFAULT_TASK_TITLE_MAX_CHARS = 100;

export function normalizeTaskTitleWhitespace(value: string): string {
	return value.replaceAll(/\s+/g, " ").trim();
}

export function validateTaskTitle(value: string, maxChars = DEFAULT_TASK_TITLE_MAX_CHARS): string {
	const normalizedTitle = normalizeTaskTitleWhitespace(value);
	if (!normalizedTitle) {
		throw new Error("Task title is required.");
	}
	if (normalizedTitle.length > maxChars) {
		throw new Error(`Task title must be ${maxChars} characters or fewer.`);
	}
	return normalizedTitle;
}

function truncateTaskTitle(value: string, maxChars: number): string {
	if (maxChars <= 0) {
		return "";
	}
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
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
