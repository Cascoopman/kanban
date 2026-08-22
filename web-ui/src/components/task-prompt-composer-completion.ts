export interface ActiveTaskPromptToken {
	start: number;
	end: number;
	query: string;
}

export function detectActiveTaskPromptMention(value: string, cursorIndex: number): ActiveTaskPromptToken | null {
	if (cursorIndex < 0 || cursorIndex > value.length) {
		return null;
	}
	const head = value.slice(0, cursorIndex);
	let tokenStart = head.length;
	while (tokenStart > 0 && !/\s/.test(head[tokenStart - 1] ?? "")) {
		tokenStart -= 1;
	}

	const token = head.slice(tokenStart);
	if (!token.startsWith("@") || (tokenStart > 0 && !/\s/.test(value[tokenStart - 1] ?? ""))) {
		return null;
	}
	if (!/^[^\s@]*$/.test(token.slice(1))) {
		return null;
	}
	return { start: tokenStart, end: cursorIndex, query: token.slice(1) };
}

export function buildMentionInsertText(filePath: string): string {
	const normalizedPath = filePath.startsWith("/") ? filePath : `/${filePath}`;
	return normalizedPath.includes(" ") ? `@"${normalizedPath}"` : `@${normalizedPath}`;
}

export function applyTaskPromptCompletion(
	value: string,
	token: ActiveTaskPromptToken,
	replacement: string,
): { value: string; cursor: number } {
	const before = value.slice(0, token.start);
	const after = value.slice(token.end);
	const spacer = after.length === 0 || !/^\s/.test(after) ? " " : "";
	const nextValue = `${before}${replacement}${spacer}${after}`;
	return {
		value: nextValue,
		cursor: before.length + replacement.length + spacer.length,
	};
}
