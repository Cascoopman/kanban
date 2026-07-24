import { Copy, Play } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { BoardCard } from "@/types";

export function TaskBranchDialog({
	open,
	sourceTask,
	prompt,
	onPromptChange,
	isPending,
	onOpenChange,
	onCreate,
	onCreateAndStart,
}: {
	open: boolean;
	sourceTask: BoardCard | null;
	prompt: string;
	onPromptChange: (value: string) => void;
	isPending: boolean;
	onOpenChange: (open: boolean) => void;
	onCreate: () => void;
	onCreateAndStart: () => void;
}): React.ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	useEffect(() => {
		if (open) {
			textareaRef.current?.focus();
		}
	}, [open]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!isPending && prompt.trim()) {
			onCreate();
		}
	};

	const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
			return;
		}
		event.preventDefault();
		if (isPending || !prompt.trim()) {
			return;
		}
		if (event.shiftKey) {
			onCreateAndStart();
			return;
		}
		onCreate();
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-md">
			<form onSubmit={handleSubmit}>
				<DialogHeader title="Branch task" icon={<Copy size={15} />} />
				<DialogBody className="space-y-3">
					<p className="text-sm text-text-secondary">
						Create a new task from <span className="text-text-primary">{sourceTask?.title}</span>, including its
						current Git state and Codex context when available.
					</p>
					<label className="block">
						<span className="mb-1.5 block text-xs font-medium text-text-secondary">New task</span>
						<textarea
							ref={textareaRef}
							value={prompt}
							onChange={(event) => onPromptChange(event.currentTarget.value)}
							onKeyDown={handlePromptKeyDown}
							placeholder="Describe the new task..."
							rows={5}
							className="w-full resize-y rounded-md border border-border-bright bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
					</label>
				</DialogBody>
				<DialogFooter>
					<Button type="button" variant="default" disabled={isPending} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<div className="flex gap-2">
						<Button
							type="submit"
							disabled={isPending || !prompt.trim()}
							icon={isPending ? <Spinner size={14} /> : <Copy size={14} />}
						>
							Create task
						</Button>
						<Button
							type="button"
							variant="primary"
							disabled={isPending || !prompt.trim()}
							icon={isPending ? <Spinner size={14} /> : <Play size={14} />}
							onClick={onCreateAndStart}
						>
							Create &amp; start
						</Button>
					</div>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
