import { Command, CornerDownLeft, Sparkles } from "lucide-react";
import type { Dispatch, ReactElement, SetStateAction } from "react";
import { useCallback, useId } from "react";

import { TaskPromptComposer } from "@/components/task-prompt-composer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { TaskImage } from "@/types";

function StartShortcut(): ReactElement {
	return (
		<span className="ml-1.5 inline-flex items-center gap-0.5" aria-hidden>
			<Command size={12} />
			<CornerDownLeft size={12} />
		</span>
	);
}

export function TaskCreateDialog({
	open,
	onOpenChange,
	prompt,
	onPromptChange,
	images,
	onImagesChange,
	onCreateStartAndOpen,
	workspaceId,
	canStart,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	prompt: string;
	onPromptChange: (value: string) => void;
	images: TaskImage[];
	onImagesChange: Dispatch<SetStateAction<TaskImage[]>>;
	onCreateStartAndOpen: () => string | null;
	workspaceId: string | null;
	canStart: boolean;
}): ReactElement {
	const promptInputId = useId();
	const handleStart = useCallback(() => {
		onCreateStartAndOpen();
	}, [onCreateStartAndOpen]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-2xl">
			<DialogHeader title="Start a task" icon={<Sparkles size={16} />} />
			<DialogBody>
				<label htmlFor={promptInputId} className="mb-1.5 block text-[11px] font-medium text-text-secondary">
					What should the agent do?
				</label>
				<TaskPromptComposer
					id={promptInputId}
					value={prompt}
					onValueChange={onPromptChange}
					images={images}
					onImagesChange={onImagesChange}
					onSubmit={handleStart}
					onSubmitAndStart={handleStart}
					onEscape={() => onOpenChange(false)}
					placeholder="Describe the outcome you want..."
					workspaceId={workspaceId}
					autoFocus
				/>
				<p className="mb-0 mt-2 text-[11px] text-text-tertiary">
					Kanban chooses the current branch and default agent, then opens the agent terminal so you can continue
					with follow-up prompts or commands.
				</p>
			</DialogBody>
			<DialogFooter>
				<Button size="sm" onClick={() => onOpenChange(false)}>
					Cancel
				</Button>
				<Button variant="primary" size="sm" onClick={handleStart} disabled={!prompt.trim() || !canStart}>
					<span className="inline-flex items-center">
						Start task
						<StartShortcut />
					</span>
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
