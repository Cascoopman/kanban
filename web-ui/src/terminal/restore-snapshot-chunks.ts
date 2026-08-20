const DEFAULT_RESTORE_CHUNK_SIZE = 16 * 1024;

export function splitTerminalRestoreSnapshot(snapshot: string, chunkSize = DEFAULT_RESTORE_CHUNK_SIZE): string[] {
	if (!snapshot) {
		return [];
	}
	if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
		throw new Error("Terminal restore chunk size must be a positive integer.");
	}

	const chunks: string[] = [];
	let offset = 0;
	while (offset < snapshot.length) {
		let end = Math.min(offset + chunkSize, snapshot.length);
		const lastCodeUnit = snapshot.charCodeAt(end - 1);
		const nextCodeUnit = snapshot.charCodeAt(end);
		if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
			end += 1;
		}
		chunks.push(snapshot.slice(offset, end));
		offset = end;
	}
	return chunks;
}
