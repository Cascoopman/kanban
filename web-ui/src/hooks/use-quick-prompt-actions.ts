import { useCallback } from "react";
import { showAppToast } from "@/components/app-toaster";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";

export function useQuickPromptActions({
	sendTaskSessionInput,
}: {
	sendTaskSessionInput: UseTaskSessionsResult["sendTaskSessionInput"];
}): {
	handleSendQuickPrompt: (taskId: string, prompt: string) => Promise<void>;
} {
	const handleSendQuickPrompt = useCallback(
		async (taskId: string, prompt: string) => {
			const typed = await sendTaskSessionInput(taskId, prompt, { appendNewline: false, mode: "paste" });
			if (!typed.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: typed.message ?? "Could not send the prompt to the task session.",
					timeout: 7000,
				});
				return;
			}

			await new Promise<void>((resolve) => {
				setTimeout(resolve, 200);
			});
			const submitted = await sendTaskSessionInput(taskId, "\r", { appendNewline: false });
			if (!submitted.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: submitted.message ?? "Could not submit the prompt to the task session.",
					timeout: 7000,
				});
			}
		},
		[sendTaskSessionInput],
	);

	return { handleSendQuickPrompt };
}
