import type { RuntimeQuickPrompt } from "@/runtime/types";
import type { BoardColumnId } from "@/types";

export function areRuntimeQuickPromptsEqual(
	left: readonly RuntimeQuickPrompt[],
	right: readonly RuntimeQuickPrompt[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((item, index) => {
		const comparison = right[index];
		return (
			comparison !== undefined &&
			item.label === comparison.label &&
			item.prompt === comparison.prompt &&
			item.context === comparison.context
		);
	});
}

export function isQuickPromptVisibleInColumn(quickPrompt: RuntimeQuickPrompt, columnId: BoardColumnId): boolean {
	if (columnId !== "in_progress" && columnId !== "review") {
		return false;
	}
	return quickPrompt.context === "any" || quickPrompt.context === columnId;
}
