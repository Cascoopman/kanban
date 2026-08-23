import type { WriteStream } from "node:tty";

import { getLogFilePath, TimestampedLogWriter } from "./log-files";

type WriteCallback = (error?: Error | null) => void;
type WritableChunk = string | Uint8Array;

export interface BackendLogCapture {
	close: () => void;
	runWithoutCapture: <Result>(callback: () => Result) => Result;
}

interface InstallBackendLogCaptureOptions {
	stdout?: WriteStream;
	stderr?: WriteStream;
	path?: string;
	now?: () => Date;
}

function chunkToString(chunk: WritableChunk, encoding?: BufferEncoding): string {
	return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(encoding);
}

export function installBackendLogCapture(options: InstallBackendLogCaptureOptions = {}): BackendLogCapture {
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const writer = new TimestampedLogWriter(options.path ?? getLogFilePath("backend"));
	const now = options.now ?? (() => new Date());
	const originalStdoutWrite = stdout.write.bind(stdout);
	const originalStderrWrite = stderr.write.bind(stderr);
	let captureEnabled = true;

	const createMirroredWrite = (
		channel: "stdout" | "stderr",
		originalWrite: WriteStream["write"],
	): WriteStream["write"] =>
		((
			chunk: WritableChunk,
			encodingOrCallback?: BufferEncoding | WriteCallback,
			callback?: WriteCallback,
		): boolean => {
			if (captureEnabled) {
				const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
				writer.writeChunk(channel, chunkToString(chunk, encoding), now());
			}
			if (typeof encodingOrCallback === "function") {
				return originalWrite(chunk, encodingOrCallback);
			}
			if (encodingOrCallback !== undefined) {
				return originalWrite(chunk, encodingOrCallback, callback);
			}
			return originalWrite(chunk);
		}) as WriteStream["write"];

	stdout.write = createMirroredWrite("stdout", originalStdoutWrite);
	stderr.write = createMirroredWrite("stderr", originalStderrWrite);

	return {
		close: () => {
			stdout.write = originalStdoutWrite;
			stderr.write = originalStderrWrite;
			writer.close();
		},
		runWithoutCapture: <Result>(callback: () => Result): Result => {
			captureEnabled = false;
			try {
				return callback();
			} finally {
				captureEnabled = true;
			}
		},
	};
}
