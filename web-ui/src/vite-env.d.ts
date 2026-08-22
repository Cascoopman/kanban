/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
	readonly POSTHOG_KEY?: string;
	readonly POSTHOG_HOST?: string;
	readonly VITE_KANBAN_ISOLATED_PREVIEW?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
