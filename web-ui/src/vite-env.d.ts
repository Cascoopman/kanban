/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
	readonly VITE_SENTRY_DSN?: string;
	readonly VITE_KANBAN_ISOLATED_PREVIEW?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
