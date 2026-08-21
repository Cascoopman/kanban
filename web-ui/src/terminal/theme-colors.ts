import { useMemo } from "react";

import { getTerminalThemeColors, type ThemeTerminalColors, useTheme } from "@/hooks/use-theme";

/** React hook that returns terminal colors matching the active theme. */
export function useTerminalThemeColors(): ThemeTerminalColors {
	const { themeId } = useTheme();
	return useMemo(() => getTerminalThemeColors(themeId), [themeId]);
}
