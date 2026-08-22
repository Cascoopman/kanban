export const KANBAN_THEME_IDS = [
	"default",
	"graphite",
	"midnight",
	"pitch",
	"solarized-dark",
	"light",
	"overcast",
	"solarized-light",
	"latte",
	"high-contrast-dark",
	"high-contrast-light",
] as const;

export type KanbanThemeId = (typeof KANBAN_THEME_IDS)[number];

export const VSCODE_COLOR_THEMES = [
	"Dark Modern",
	"Solarized Dark",
	"Light Modern",
	"Solarized Light",
	"Default High Contrast",
	"Default High Contrast Light",
] as const;

export type VsCodeColorTheme = (typeof VSCODE_COLOR_THEMES)[number];

export const DEFAULT_VSCODE_COLOR_THEME: VsCodeColorTheme = "Dark Modern";
export const VSCODE_COLOR_THEME_QUERY_PARAMETER = "kanban-vscode-theme";

const VSCODE_COLOR_THEME_BY_KANBAN_THEME: Record<KanbanThemeId, VsCodeColorTheme> = {
	default: DEFAULT_VSCODE_COLOR_THEME,
	graphite: DEFAULT_VSCODE_COLOR_THEME,
	midnight: DEFAULT_VSCODE_COLOR_THEME,
	pitch: DEFAULT_VSCODE_COLOR_THEME,
	"solarized-dark": "Solarized Dark",
	light: "Light Modern",
	overcast: "Light Modern",
	"solarized-light": "Solarized Light",
	latte: "Light Modern",
	"high-contrast-dark": "Default High Contrast",
	"high-contrast-light": "Default High Contrast Light",
};

const VSCODE_COLOR_THEME_SET = new Set<string>(VSCODE_COLOR_THEMES);

export function isKanbanThemeId(value: string | null | undefined): value is KanbanThemeId {
	return value !== null && value !== undefined && KANBAN_THEME_IDS.some((themeId) => themeId === value);
}

export function resolveVsCodeColorTheme(themeId: KanbanThemeId): VsCodeColorTheme {
	return VSCODE_COLOR_THEME_BY_KANBAN_THEME[themeId];
}

export function isSupportedVsCodeColorTheme(value: string | null): value is VsCodeColorTheme {
	return value !== null && VSCODE_COLOR_THEME_SET.has(value);
}
