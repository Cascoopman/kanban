import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { DEFAULT_TASK_TITLE_MAX_CHARS } from "@runtime-task-title";
import { ArrowBigUp, Check, Command, CornerDownLeft, PencilLine } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useId, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import type { BranchSelectOption } from "@/components/branch-select-dropdown";
import { BranchSelectDropdown } from "@/components/branch-select-dropdown";
import { TaskAgentModelPicker, useTaskAgentModelPicker } from "@/components/task-agent-model-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { RuntimeAgentId } from "@/runtime/types";

function ButtonShortcut(): ReactElement {
	return (
		<span className="ml-1.5 inline-flex items-center gap-0.5" aria-hidden>
			<Command size={12} />
			<ArrowBigUp size={12} />
			<CornerDownLeft size={12} />
		</span>
	);
}

export function TaskCreateDialog({
	open,
	onOpenChange,
	title,
	onTitleChange,
	onCreateAndOpen,
	startInPlanMode,
	onStartInPlanModeChange,
	startInPlanModeDisabled = false,
	branchRef,
	branchOptions,
	onBranchRefChange,
	agentId,
	onAgentIdChange,
	defaultAgentId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	onTitleChange: (value: string) => void;
	onCreateAndOpen: () => string | null;
	startInPlanMode: boolean;
	onStartInPlanModeChange: (value: boolean) => void;
	startInPlanModeDisabled?: boolean;
	branchRef: string;
	branchOptions: BranchSelectOption[];
	onBranchRefChange: (value: string) => void;
	agentId?: RuntimeAgentId | undefined;
	onAgentIdChange?: (value: RuntimeAgentId | undefined) => void;
	/** Default agent ID from runtimeConfig.selectedAgentId, used to show "Default (AgentName)" in picker */
	defaultAgentId?: RuntimeAgentId | null;
}): ReactElement {
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const titleInputId = useId();
	const startInPlanModeId = useId();
	const { agentOptions } = useTaskAgentModelPicker({
		active: open,
		agentId,
		defaultAgentId,
	});
	const canCreate = title.trim().length > 0 && branchRef.length > 0;

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

	useHotkeys(
		"mod+shift+enter",
		() => {
			if (canCreate) {
				onCreateAndOpen();
			}
		},
		{
			enabled: open,
			enableOnFormTags: true,
			preventDefault: true,
		},
		[canCreate, onCreateAndOpen, open],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-lg">
			<DialogHeader title="Create task" icon={<PencilLine size={16} />} />
			<DialogBody>
				<div className="flex flex-col gap-4">
					<div>
						<label htmlFor={titleInputId} className="mb-1.5 block text-[11px] font-medium text-text-secondary">
							Title
						</label>
						<input
							ref={titleInputRef}
							id={titleInputId}
							type="text"
							value={title}
							onChange={(event) => onTitleChange(event.currentTarget.value)}
							placeholder="What are you working on?"
							maxLength={DEFAULT_TASK_TITLE_MAX_CHARS}
							className="h-10 w-full rounded-md border border-border-bright bg-surface-3 px-3 text-[15px] font-medium text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						<p className="mb-0 mt-1 text-[11px] text-text-tertiary">
							You will enter the prompt directly in the agent terminal.
						</p>
					</div>

					<label
						htmlFor={startInPlanModeId}
						className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-text-primary"
					>
						<RadixCheckbox.Root
							id={startInPlanModeId}
							checked={startInPlanMode}
							onCheckedChange={(checked) => onStartInPlanModeChange(checked === true)}
							disabled={startInPlanModeDisabled}
							className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-default disabled:opacity-40"
						>
							<RadixCheckbox.Indicator>
								<Check size={10} className="text-white" />
							</RadixCheckbox.Indicator>
						</RadixCheckbox.Root>
						Start in plan mode
					</label>

					<div>
						<span className="mb-1 block text-[11px] text-text-secondary">Worktree base ref</span>
						<BranchSelectDropdown
							options={branchOptions}
							selectedValue={branchRef}
							onSelect={onBranchRefChange}
							fill
							size="sm"
							emptyText="No branches detected"
						/>
					</div>

					{onAgentIdChange ? (
						<TaskAgentModelPicker
							agentId={agentId}
							onAgentIdChange={onAgentIdChange}
							agentOptions={agentOptions}
						/>
					) : null}
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="primary" size="sm" onClick={onCreateAndOpen} disabled={!canCreate}>
					<span className="inline-flex items-center">
						Create and open terminal
						<ButtonShortcut />
					</span>
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
