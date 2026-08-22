import { Plus, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { isQuickPromptVisibleInColumn } from "@/quick-prompts/quick-prompt-utils";
import type { RuntimeQuickPrompt } from "@/runtime/types";
import type { BoardColumnId } from "@/types";

export function AgentQuickPromptActions({
	quickPrompts,
	columnId,
	disabled,
	onSend,
	onEdit,
}: {
	quickPrompts: readonly RuntimeQuickPrompt[];
	columnId: BoardColumnId;
	disabled: boolean;
	onSend: (prompt: string) => Promise<void>;
	onEdit: () => void;
}): React.ReactElement {
	const [sendingIndex, setSendingIndex] = useState<number | null>(null);
	const visibleQuickPrompts = useMemo(
		() => quickPrompts.filter((quickPrompt) => isQuickPromptVisibleInColumn(quickPrompt, columnId)),
		[columnId, quickPrompts],
	);

	const handleSend = async (prompt: string, index: number): Promise<void> => {
		setSendingIndex(index);
		try {
			await onSend(prompt);
		} finally {
			setSendingIndex(null);
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
			{visibleQuickPrompts.map((quickPrompt, index) => (
				<Tooltip key={`${quickPrompt.label}-${index}`} side="top" content={quickPrompt.prompt}>
					<Button
						variant="default"
						size="sm"
						onClick={() => void handleSend(quickPrompt.prompt, index)}
						disabled={disabled || sendingIndex !== null}
					>
						{sendingIndex === index ? "Sending..." : quickPrompt.label}
					</Button>
				</Tooltip>
			))}
			{quickPrompts.length === 0 ? (
				<Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={onEdit}>
					Add quick prompt
				</Button>
			) : (
				<Tooltip side="top" content="Edit quick prompts">
					<Button
						variant="ghost"
						size="sm"
						icon={<Settings2 size={14} />}
						onClick={onEdit}
						aria-label="Edit quick prompts"
					/>
				</Tooltip>
			)}
		</div>
	);
}
