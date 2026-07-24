import { DEFAULT_TASK_TITLE_MAX_CHARS } from "@runtime-task-title";
import { ArrowBigUp, Command, Copy, CornerDownLeft, Play } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactElement, useEffect, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { BoardCard } from "@/types";

function ButtonShortcut({ includeShift = false }: { includeShift?: boolean }): ReactElement {
	return (
		<span className="ml-1.5 inline-flex items-center gap-0.5" aria-hidden>
			<Command size={12} />
			{includeShift ? <ArrowBigUp size={12} /> : null}
			<CornerDownLeft size={12} />
		</span>
	);
}

export function TaskBranchDialog({
	open,
	sourceTask,
	title,
	onTitleChange,
	prompt,
	onPromptChange,
	isPending,
	onOpenChange,
	onCreate,
	onCreateAndStart,
}: {
	open: boolean;
	sourceTask: BoardCard | null;
	title: string;
	onTitleChange: (value: string) => void;
	prompt: string;
	onPromptChange: (value: string) => void;
	isPending: boolean;
	onOpenChange: (open: boolean) => void;
	onCreate: () => void;
	onCreateAndStart: () => void;
}): React.ReactElement {
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		if (!open) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		});
		return () => window.cancelAnimationFrame(frame);
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

	useHotkeys(
		"mod+enter, mod+shift+enter",
		(event) => {
			if (isPending || !prompt.trim()) {
				return;
			}
			if (event.shiftKey) {
				onCreateAndStart();
				return;
			}
			onCreate();
		},
		{
			enabled: open,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => event.defaultPrevented,
			preventDefault: true,
		},
		[open, isPending, onCreate, onCreateAndStart, prompt],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-md">
			<form onSubmit={handleSubmit}>
				<DialogHeader title="Branch task" icon={<Copy size={15} />} />
				<DialogBody className="space-y-4">
					<p className="text-sm text-text-secondary">
						Create a new task from <span className="text-text-primary">{sourceTask?.title}</span>, including its
						current Git state and Codex context when available.
					</p>
					<label className="block">
						<span className="mb-1.5 block text-xs font-medium text-text-secondary">Title</span>
						<input
							ref={titleInputRef}
							type="text"
							value={title}
							onChange={(event) => onTitleChange(event.currentTarget.value)}
							placeholder="Generated from the prompt"
							maxLength={DEFAULT_TASK_TITLE_MAX_CHARS}
							className="h-10 w-full rounded-md border border-border-bright bg-surface-2 px-3 text-[15px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<span className="mt-1 block text-[11px] text-text-tertiary">
							Leave blank to generate a title from the prompt.
						</span>
					</label>
					<label className="block">
						<span className="mb-1.5 block text-xs font-medium text-text-secondary">Prompt</span>
						<textarea
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
							<span className="inline-flex items-center">
								Create task
								<ButtonShortcut />
							</span>
						</Button>
						<Button
							type="button"
							variant="primary"
							disabled={isPending || !prompt.trim()}
							icon={isPending ? <Spinner size={14} /> : <Play size={14} />}
							onClick={onCreateAndStart}
						>
							<span className="inline-flex items-center">
								Create &amp; start
								<ButtonShortcut includeShift />
							</span>
						</Button>
					</div>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
