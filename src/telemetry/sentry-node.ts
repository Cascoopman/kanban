import * as Sentry from "@sentry/node";
import packageJson from "../../package.json" with { type: "json" };

const nodeSentryDsn = process.env.SENTRY_DSN?.trim();

const appVersion = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

let initialized = false;
const nodeSentryEnvironment =
	process.env.SENTRY_NODE_ENVIRONMENT?.trim() || process.env.NODE_ENV?.trim() || "development";

if (nodeSentryDsn) {
	Sentry.init({
		dsn: nodeSentryDsn,
		environment: nodeSentryEnvironment,
		release: `kanban@${appVersion}`,
		// Sentry's ESM hook still uses Node's deprecated module.register() API.
		// Kanban reports exceptions explicitly, so automatic ESM instrumentation is unnecessary.
		registerEsmLoaderHooks: false,
		sendDefaultPii: false,
		initialScope: {
			tags: {
				app: "kanban",
				runtime_surface: "node",
			},
		},
		beforeSend(event) {
			return {
				...event,
				breadcrumbs: event.breadcrumbs?.map(({ data: _data, ...breadcrumb }) => breadcrumb),
				contexts: undefined,
				extra: undefined,
				request: undefined,
				user: undefined,
			};
		},
	});
	initialized = true;
}

interface CaptureNodeExceptionOptions {
	area?: string;
}

export function captureNodeException(error: unknown, options?: CaptureNodeExceptionOptions): void {
	if (!initialized) {
		return;
	}

	Sentry.withScope((scope) => {
		if (options?.area) {
			scope.setTag("error_area", options.area);
		}
		Sentry.captureException(error);
	});
}

export async function flushNodeTelemetry(timeoutMs = 2_000): Promise<void> {
	if (!initialized) {
		return;
	}
	await Sentry.flush(timeoutMs);
}
