# Kanban Web UI

This package contains the Kanban frontend served by the runtime.

## Stack

- React + TypeScript + Vite
- Tailwind CSS v4 and Radix UI
- `@hello-pangea/dnd`
- Vitest
- Playwright

## Telemetry

PostHog telemetry is off unless you explicitly configure a PostHog key and host.

1. Copy `web-ui/.env.example` to `web-ui/.env.local`.
2. Set `POSTHOG_KEY` to your PostHog project key.
3. Set `POSTHOG_HOST` to your PostHog ingestion host.

When either `POSTHOG_KEY` or `POSTHOG_HOST` is empty or unset, the app does not initialize PostHog.

Current behavior:
- Session replay is disabled.
- Autocapture is disabled. This means PostHog does not automatically capture clicks, form edits, or other raw DOM interactions.
- Pageview events are enabled for active user metrics.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npm run e2e`
