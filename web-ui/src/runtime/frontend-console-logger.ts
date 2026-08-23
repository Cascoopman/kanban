const FORWARDED_CONSOLE_METHODS = ["debug", "log", "info", "warn", "error"] as const;

type ForwardedConsoleMethod = (typeof FORWARDED_CONSOLE_METHODS)[number];
type ConsoleMethod = (...args: unknown[]) => void;

function formatConsoleArgument(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value instanceof Error) {
		return value.stack || value.message;
	}
	if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
		return String(value);
	}
	try {
		const seen = new WeakSet<object>();
		const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
			if (typeof nestedValue === "bigint") {
				return String(nestedValue);
			}
			if (nestedValue !== null && typeof nestedValue === "object") {
				if (seen.has(nestedValue)) {
					return "[Circular]";
				}
				seen.add(nestedValue);
			}
			return nestedValue;
		});
		return serialized ?? String(value);
	} catch {
		return String(value);
	}
}

function forwardConsoleEntry(level: ForwardedConsoleMethod, args: unknown[]): void {
	const payload = JSON.stringify({
		timestamp: new Date().toISOString(),
		level,
		message: args.map(formatConsoleArgument).join(" "),
	});
	void fetch("/api/logs/frontend", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: payload,
		credentials: "same-origin",
		keepalive: true,
	}).catch(() => {
		// Logging must never affect the application or recursively log failures.
	});
}

export function installFrontendConsoleLogger(): () => void {
	const originalMethods = new Map<ForwardedConsoleMethod, ConsoleMethod>();
	for (const method of FORWARDED_CONSOLE_METHODS) {
		const original = console[method].bind(console) as ConsoleMethod;
		originalMethods.set(method, original);
		console[method] = ((...args: unknown[]) => {
			original(...args);
			forwardConsoleEntry(method, args);
		}) as (typeof console)[typeof method];
	}

	return () => {
		for (const [method, original] of originalMethods) {
			console[method] = original as (typeof console)[typeof method];
		}
	};
}
