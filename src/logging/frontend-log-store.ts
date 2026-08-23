import { getLogFilePath, TimestampedLogWriter } from "./log-files";

export const FRONTEND_LOG_LEVELS = ["debug", "log", "info", "warn", "error"] as const;

export type FrontendLogLevel = (typeof FRONTEND_LOG_LEVELS)[number];

export interface FrontendLogEntry {
	timestamp: Date;
	level: FrontendLogLevel;
	message: string;
}

export function parseFrontendLogEntry(value: unknown): FrontendLogEntry | null {
	if (value === null || typeof value !== "object") {
		return null;
	}
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.timestamp !== "string" ||
		typeof candidate.level !== "string" ||
		typeof candidate.message !== "string" ||
		!FRONTEND_LOG_LEVELS.includes(candidate.level as FrontendLogLevel)
	) {
		return null;
	}
	const timestamp = new Date(candidate.timestamp);
	if (Number.isNaN(timestamp.getTime())) {
		return null;
	}
	return {
		timestamp,
		level: candidate.level as FrontendLogLevel,
		message: candidate.message,
	};
}

export class FrontendLogStore {
	private readonly writer = new TimestampedLogWriter(getLogFilePath("frontend"));

	append(entry: FrontendLogEntry): void {
		this.writer.writeLine(entry.level, entry.message, entry.timestamp);
	}

	close(): void {
		this.writer.close();
	}
}
