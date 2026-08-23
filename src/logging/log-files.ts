import { chmodSync, closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { getRuntimeHomePath } from "../core/runtime-home";

export const LOG_SOURCES = ["backend", "frontend"] as const;

export type LogSource = (typeof LOG_SOURCES)[number];

export function getLogsDirectory(): string {
	return join(getRuntimeHomePath(), "logs");
}

export function getLogFilePath(source: LogSource): string {
	return join(getLogsDirectory(), `${source}.log`);
}

interface BufferedLogChunk {
	text: string;
	timestamp: Date;
}

export class TimestampedLogWriter {
	private readonly fileDescriptor: number;
	private readonly pendingByChannel = new Map<string, BufferedLogChunk>();
	private closed = false;

	constructor(readonly path: string) {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.fileDescriptor = openSync(path, "a", 0o600);
		chmodSync(path, 0o600);
	}

	writeChunk(channel: string, chunk: string, timestamp = new Date()): void {
		if (this.closed || chunk.length === 0) {
			return;
		}

		const pending = this.pendingByChannel.get(channel);
		let remaining = `${pending?.text ?? ""}${chunk}`;
		let lineTimestamp = pending?.timestamp ?? timestamp;
		let newlineIndex = remaining.indexOf("\n");

		while (newlineIndex >= 0) {
			const line = remaining.slice(0, newlineIndex).replace(/\r$/u, "");
			this.writeRecord(channel, line, lineTimestamp);
			remaining = remaining.slice(newlineIndex + 1);
			lineTimestamp = timestamp;
			newlineIndex = remaining.indexOf("\n");
		}

		if (remaining.length > 0) {
			this.pendingByChannel.set(channel, { text: remaining, timestamp: lineTimestamp });
		} else {
			this.pendingByChannel.delete(channel);
		}
	}

	writeLine(channel: string, message: string, timestamp = new Date()): void {
		if (this.closed) {
			return;
		}
		const lines = message.replace(/\r\n/gu, "\n").split("\n");
		for (const line of lines) {
			this.writeRecord(channel, line, timestamp);
		}
	}

	close(): void {
		if (this.closed) {
			return;
		}
		for (const [channel, pending] of this.pendingByChannel) {
			this.writeRecord(channel, pending.text.replace(/\r$/u, ""), pending.timestamp);
		}
		this.pendingByChannel.clear();
		this.closed = true;
		closeSync(this.fileDescriptor);
	}

	private writeRecord(channel: string, message: string, timestamp: Date): void {
		const record = `${timestamp.toISOString()} [${channel}] ${message}\n`;
		writeSync(this.fileDescriptor, record, undefined, "utf8");
	}
}
