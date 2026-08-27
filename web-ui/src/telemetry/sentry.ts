import * as Sentry from "@sentry/react";

const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim();
const sentryEnvironment = import.meta.env.MODE;

let initialized = false;

export function initializeSentry(): void {
	if (!sentryDsn || initialized) {
		return;
	}

	Sentry.init({
		dsn: sentryDsn,
		environment: sentryEnvironment,
		release: `kanban@${__APP_VERSION__}`,
		sendDefaultPii: false,
		initialScope: {
			tags: {
				app: "kanban",
				runtime_surface: "web",
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
