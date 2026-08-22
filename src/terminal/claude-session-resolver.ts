import type { Dirent } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_SESSION_FILES_TO_SCAN = 250;
const SESSION_META_MAX_BYTES = 2 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

interface SessionFile {
	path: string;
	modifiedAt: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function listSessionFiles(rootPath: string): Promise<SessionFile[]> {
	const pending = [rootPath];
	const files: SessionFile[] = [];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) {
			continue;
		}
		let entries: Dirent[];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const entryPath = join(current, entry.name);
			if (entry.isDirectory()) {
				pending.push(entryPath);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
				continue;
			}
			try {
				files.push({
					path: entryPath,
					modifiedAt: (await stat(entryPath)).mtimeMs,
				});
			} catch {}
		}
	}
	return files.sort((left, right) => right.modifiedAt - left.modifiedAt || right.path.localeCompare(left.path));
}

function parseSessionLine(line: string, cwd: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	const record = asRecord(parsed);
	if (!record || record.cwd !== cwd || record.isSidechain === true) {
		return null;
	}
	const sessionId = record.sessionId;
	return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
}

async function findSessionIdInFile(filePath: string, cwd: string): Promise<string | null> {
	const handle = await open(filePath, "r");
	try {
		let offset = 0;
		let remaining = "";
		while (offset < SESSION_META_MAX_BYTES) {
			const byteLength = Math.min(READ_CHUNK_BYTES, SESSION_META_MAX_BYTES - offset);
			const buffer = Buffer.alloc(byteLength);
			const result = await handle.read(buffer, 0, byteLength, offset);
			if (result.bytesRead === 0) {
				break;
			}
			offset += result.bytesRead;
			const lines = `${remaining}${buffer.subarray(0, result.bytesRead).toString("utf8")}`.split("\n");
			remaining = lines.pop() ?? "";
			for (const line of lines) {
				const sessionId = parseSessionLine(line, cwd);
				if (sessionId) {
					return sessionId;
				}
			}
		}
		return parseSessionLine(remaining, cwd);
	} finally {
		await handle.close();
	}
}

export async function resolveClaudeSessionIdForCwd(
	cwd: string,
	projectsRoot = join(homedir(), ".claude", "projects"),
): Promise<string | null> {
	const normalizedCwd = cwd.trim();
	if (!normalizedCwd) {
		return null;
	}
	const sessionFiles = (await listSessionFiles(projectsRoot)).slice(0, MAX_SESSION_FILES_TO_SCAN);
	for (const sessionFile of sessionFiles) {
		try {
			const sessionId = await findSessionIdInFile(sessionFile.path, normalizedCwd);
			if (sessionId) {
				return sessionId;
			}
		} catch {}
	}
	return null;
}
