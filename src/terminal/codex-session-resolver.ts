import type { Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_ROLLOUT_FILES_TO_SCAN = 250;
const SESSION_META_MAX_BYTES = 2 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function listRolloutFiles(rootPath: string): Promise<string[]> {
	const pending = [rootPath];
	const files: string[] = [];
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
			} else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
				files.push(entryPath);
			}
		}
	}
	return files.sort((left, right) => right.localeCompare(left));
}

async function readFirstLine(filePath: string): Promise<string | null> {
	const handle = await open(filePath, "r");
	try {
		let offset = 0;
		let content = "";
		while (offset < SESSION_META_MAX_BYTES) {
			const byteLength = Math.min(READ_CHUNK_BYTES, SESSION_META_MAX_BYTES - offset);
			const buffer = Buffer.alloc(byteLength);
			const result = await handle.read(buffer, 0, byteLength, offset);
			if (result.bytesRead === 0) {
				break;
			}
			content += buffer.subarray(0, result.bytesRead).toString("utf8");
			const newlineIndex = content.indexOf("\n");
			if (newlineIndex !== -1) {
				return content.slice(0, newlineIndex);
			}
			offset += result.bytesRead;
		}
		return content || null;
	} finally {
		await handle.close();
	}
}

function parseRootSessionId(line: string, cwd: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	const record = asRecord(parsed);
	const payload = record ? asRecord(record.payload) : null;
	if (record?.type !== "session_meta" || !payload || payload.cwd !== cwd) {
		return null;
	}
	const source = asRecord(payload.source);
	if (source && source.subagent !== undefined) {
		return null;
	}
	const sessionId = typeof payload.id === "string" ? payload.id : payload.session_id;
	return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
}

export async function resolveCodexSessionIdForCwd(
	cwd: string,
	sessionsRoot = join(homedir(), ".codex", "sessions"),
): Promise<string | null> {
	const normalizedCwd = cwd.trim();
	if (!normalizedCwd) {
		return null;
	}
	const rolloutFiles = (await listRolloutFiles(sessionsRoot)).slice(0, MAX_ROLLOUT_FILES_TO_SCAN);
	for (const filePath of rolloutFiles) {
		try {
			const firstLine = await readFirstLine(filePath);
			if (!firstLine) {
				continue;
			}
			const sessionId = parseRootSessionId(firstLine, normalizedCwd);
			if (sessionId) {
				return sessionId;
			}
		} catch {}
	}
	return null;
}
