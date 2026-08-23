import { open, stat } from "node:fs/promises";
import { Argument, type Command, InvalidArgumentError } from "commander";

import { getLogFilePath, LOG_SOURCES, type LogSource } from "../logging/log-files";

interface StoredLogLine {
	source: LogSource;
	line: string;
	timestamp: string;
	ordinal: number;
}

interface LogCursor {
	offset: number;
	remainder: string;
}

interface LogSnapshot {
	lines: StoredLogLine[];
	offsets: ReadonlyMap<LogSource, number>;
}

function parseTailCount(value: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new InvalidArgumentError("Expected a non-negative integer.");
	}
	return parsed;
}

function parseStoredLines(source: LogSource, content: string): StoredLogLine[] {
	return content
		.split(/\r?\n/u)
		.filter((line) => line.length > 0)
		.map((line, ordinal) => ({
			source,
			line,
			timestamp: line.match(/^(\S+)/u)?.[1] ?? "",
			ordinal,
		}));
}

async function readSourceSnapshot(source: LogSource): Promise<{ lines: StoredLogLine[]; offset: number }> {
	const path = getLogFilePath(source);
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "r");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { lines: [], offset: 0 };
		}
		throw error;
	}
	try {
		const size = (await handle.stat()).size;
		const buffer = Buffer.alloc(size);
		let bytesRead = 0;
		while (bytesRead < size) {
			const result = await handle.read(buffer, bytesRead, size - bytesRead, bytesRead);
			if (result.bytesRead === 0) {
				break;
			}
			bytesRead += result.bytesRead;
		}
		return {
			lines: parseStoredLines(source, buffer.subarray(0, bytesRead).toString("utf8")),
			offset: bytesRead,
		};
	} finally {
		await handle.close();
	}
}

export async function readLogSnapshot(sources: readonly LogSource[], tail: number | null): Promise<LogSnapshot> {
	const snapshots = await Promise.all(sources.map(async (source) => await readSourceSnapshot(source)));
	const lines = snapshots.flatMap((snapshot) => snapshot.lines);
	lines.sort((left, right) =>
		left.timestamp === right.timestamp
			? left.source.localeCompare(right.source) || left.ordinal - right.ordinal
			: left.timestamp.localeCompare(right.timestamp),
	);
	return {
		lines: tail === null ? lines : tail === 0 ? [] : lines.slice(-tail),
		offsets: new Map(sources.map((source, index) => [source, snapshots[index]?.offset ?? 0])),
	};
}

export async function readLogLines(sources: readonly LogSource[], tail: number | null): Promise<StoredLogLine[]> {
	return (await readLogSnapshot(sources, tail)).lines;
}

export function formatLogLine(entry: StoredLogLine, showSource: boolean): string {
	if (!showSource) {
		return entry.line;
	}
	const separatorIndex = entry.line.indexOf(" ");
	if (separatorIndex < 0) {
		return `[${entry.source}] ${entry.line}`;
	}
	return `${entry.line.slice(0, separatorIndex)} [${entry.source}]${entry.line.slice(separatorIndex)}`;
}

async function getFileSize(source: LogSource): Promise<number> {
	try {
		return (await stat(getLogFilePath(source))).size;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return 0;
		}
		throw error;
	}
}

async function readAppendedLines(source: LogSource, cursor: LogCursor): Promise<StoredLogLine[]> {
	const path = getLogFilePath(source);
	let size: number;
	try {
		size = (await stat(path)).size;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			cursor.offset = 0;
			cursor.remainder = "";
			return [];
		}
		throw error;
	}
	if (size < cursor.offset) {
		cursor.offset = 0;
		cursor.remainder = "";
	}
	if (size === cursor.offset) {
		return [];
	}

	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(size - cursor.offset);
		await handle.read(buffer, 0, buffer.length, cursor.offset);
		cursor.offset = size;
		const combined = `${cursor.remainder}${buffer.toString("utf8")}`;
		const parts = combined.split("\n");
		cursor.remainder = parts.pop() ?? "";
		return parseStoredLines(source, parts.join("\n"));
	} finally {
		await handle.close();
	}
}

function waitForPoll(signal: AbortSignal, delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const handleAbort = () => {
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", handleAbort);
			resolve();
		}, delayMs);
		signal.addEventListener("abort", handleAbort, { once: true });
	});
}

export async function followLogLines(
	sources: readonly LogSource[],
	onLines: (lines: StoredLogLine[]) => void,
	signal: AbortSignal,
	pollIntervalMs = 250,
	initialOffsets?: ReadonlyMap<LogSource, number>,
): Promise<void> {
	const cursors = new Map<LogSource, LogCursor>();
	for (const source of sources) {
		cursors.set(source, { offset: initialOffsets?.get(source) ?? (await getFileSize(source)), remainder: "" });
	}

	while (!signal.aborted) {
		await waitForPoll(signal, pollIntervalMs);
		if (signal.aborted) {
			break;
		}
		const lines = (
			await Promise.all(
				sources.map(async (source) => await readAppendedLines(source, cursors.get(source) as LogCursor)),
			)
		).flat();
		lines.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
		if (lines.length > 0) {
			onLines(lines);
		}
	}
}

export function registerLogsCommand(program: Command): void {
	program
		.command("logs")
		.description("Read persisted Kanban frontend and backend logs.")
		.addArgument(new Argument("[source]", "Log source to read.").choices([...LOG_SOURCES]))
		.option("--all", "Read both frontend and backend logs.")
		.option("-n, --tail <lines>", "Show only the last number of lines.", parseTailCount)
		.option("-f, --follow", "Continue printing new log lines.")
		.action(
			async (
				source: LogSource | undefined,
				options: { all?: boolean; tail?: number; follow?: boolean },
			): Promise<void> => {
				if (source && options.all) {
					throw new Error("Choose a log source or --all, not both.");
				}
				const sources: readonly LogSource[] = source ? [source] : LOG_SOURCES;
				const showSource = sources.length > 1;
				const writeLines = (lines: StoredLogLine[]) => {
					if (lines.length > 0) {
						process.stdout.write(`${lines.map((line) => formatLogLine(line, showSource)).join("\n")}\n`);
					}
				};

				const snapshot = await readLogSnapshot(sources, options.tail ?? null);
				writeLines(snapshot.lines);
				if (!options.follow) {
					return;
				}

				const controller = new AbortController();
				const stopFollowing = () => controller.abort();
				process.once("SIGINT", stopFollowing);
				process.once("SIGTERM", stopFollowing);
				try {
					await followLogLines(sources, writeLines, controller.signal, 250, snapshot.offsets);
				} finally {
					process.removeListener("SIGINT", stopFollowing);
					process.removeListener("SIGTERM", stopFollowing);
				}
			},
		);
}
