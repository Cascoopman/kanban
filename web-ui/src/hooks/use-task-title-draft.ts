import { deriveTaskTitleFromPrompt } from "@runtime-task-title";
import { useCallback, useState } from "react";

const DEFAULT_NEW_TASK_TITLE = "New task";

export function useTaskTitleDraft(prompt: string): {
	title: string;
	explicitTitle: string | undefined;
	onTitleChange: (value: string) => void;
	resetTitle: () => void;
} {
	const [customTitle, setCustomTitle] = useState<string | null>(null);
	const onTitleChange = useCallback((value: string) => {
		setCustomTitle(value);
	}, []);
	const resetTitle = useCallback(() => {
		setCustomTitle(null);
	}, []);

	return {
		title: customTitle ?? (deriveTaskTitleFromPrompt(prompt) || DEFAULT_NEW_TASK_TITLE),
		explicitTitle: customTitle ?? undefined,
		onTitleChange,
		resetTitle,
	};
}
