import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { ArrowBigUp, Check, Command, CornerDownLeft } from "lucide-react";
import { type ReactElement, useCallback, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { BranchSelectDropdown, type BranchSelectOption } from "@/components/branch-select-dropdown";
import { TaskAgentModelPicker, useTaskAgentModelPicker } from "@/components/task-agent-model-picker";
import { Button } from "@/components/ui/button";
import type { RuntimeAgentId } from "@/runtime/types";
import { useDocumentEvent, useMeasure } from "@/utils/react-use";

export type TaskBranchOption = BranchSelectOption;

const COMPACT_ACTIONS_WIDTH_THRESHOLD_PX = 280;

function ButtonShortcut({ includeShift = false }: { includeShift?: boolean }): ReactElement {
	return (
		<span className="ml-1.5 inline-flex items-center gap-0.5" aria-hidden>
			<Command size={12} />
			{includeShift ? <ArrowBigUp size={12} /> : null}
			<CornerDownLeft size={12} />
		</span>
	);
}

export function TaskInlineCreateCard({
	onCreate,
	onCreateAndStart,
	onCancel,
	startInPlanMode,
	onStartInPlanModeChange,
	startInPlanModeDisabled = false,
	branchRef,
	branchOptions,
	onBranchRefChange,
	enabled = true,
	idPrefix = "inline-task",
	agentId,
	onAgentIdChange,
	defaultAgentId,
}: {
	onCreate: () => void;
	onCreateAndStart?: () => void;
	onCancel?: () => void;
	startInPlanMode: boolean;
	onStartInPlanModeChange: (value: boolean) => void;
	startInPlanModeDisabled?: boolean;
	branchRef: string;
	branchOptions: TaskBranchOption[];
	onBranchRefChange: (value: string) => void;
	enabled?: boolean;
	idPrefix?: string;
	agentId?: RuntimeAgentId | undefined;
	onAgentIdChange?: (value: RuntimeAgentId | undefined) => void;
	/** Default agent ID from runtimeConfig.selectedAgentId, used to show "Default (AgentName)" in picker */
	defaultAgentId?: RuntimeAgentId | null;
}): ReactElement {
	const planModeId = `${idPrefix}-plan-mode-toggle`;
	const branchSelectId = `${idPrefix}-branch-select`;
	const [measureRef, cardRect] = useMeasure<HTMLDivElement>();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [isBranchPopoverOpen, setIsBranchPopoverOpen] = useState(false);
	const setCardRef = useCallback(
		(node: HTMLDivElement | null) => {
			containerRef.current = node;
			if (node) {
				measureRef(node);
			}
		},
		[measureRef],
	);
	const isCompactActions = cardRect.width > 0 && cardRect.width < COMPACT_ACTIONS_WIDTH_THRESHOLD_PX;

	const { agentOptions } = useTaskAgentModelPicker({
		active: true,
		agentId,
		defaultAgentId,
	});

	useHotkeys(
		"escape",
		(event) => {
			if (!onCancel || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
				return;
			}
			onCancel();
		},
		{
			enabled: enabled && Boolean(onCancel),
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => event.defaultPrevented,
			preventDefault: true,
		},
		[enabled, onCancel],
	);

	useDocumentEvent(
		"pointerdown",
		(event) => {
			if (!enabled || isBranchPopoverOpen) {
				return;
			}
			const container = containerRef.current;
			if (!container || (event.target instanceof Node && container.contains(event.target))) {
				return;
			}
			onCreate();
		},
		true,
	);

	return (
		<div ref={setCardRef} className="rounded-md border border-border-bright bg-surface-2 p-3">
			<div className="flex flex-col gap-2">
				<label
					htmlFor={planModeId}
					className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-text-primary"
				>
					<RadixCheckbox.Root
						id={planModeId}
						aria-label="Start in plan mode"
						checked={startInPlanMode}
						onCheckedChange={(checked) => onStartInPlanModeChange(checked === true)}
						disabled={startInPlanModeDisabled || !enabled}
						className="flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-default disabled:opacity-40"
					>
						<RadixCheckbox.Indicator>
							<Check size={10} className="text-white" />
						</RadixCheckbox.Indicator>
					</RadixCheckbox.Root>
					<span>Start in plan mode</span>
				</label>

				<div>
					<span className="mb-1 block text-[11px] text-text-secondary">Worktree base ref</span>
					<BranchSelectDropdown
						id={branchSelectId}
						options={branchOptions}
						selectedValue={branchRef}
						onSelect={onBranchRefChange}
						onPopoverOpenChange={setIsBranchPopoverOpen}
						fill
						size="sm"
						emptyText="No branches detected"
					/>
				</div>

				{onAgentIdChange ? (
					<TaskAgentModelPicker agentId={agentId} onAgentIdChange={onAgentIdChange} agentOptions={agentOptions} />
				) : null}
			</div>

			<div className="mt-3 flex justify-end gap-2">
				{onCancel ? (
					<Button variant="default" size="sm" className="whitespace-nowrap" onClick={onCancel}>
						{isCompactActions ? "Cancel" : "Cancel (esc)"}
					</Button>
				) : null}
				<Button size="sm" className="whitespace-nowrap" onClick={onCreate} disabled={!branchRef}>
					<span className="inline-flex items-center">
						<span>Save</span>
						{isCompactActions ? null : <ButtonShortcut />}
					</span>
				</Button>
				{onCreateAndStart ? (
					<Button
						variant="primary"
						size="sm"
						className="whitespace-nowrap"
						onClick={onCreateAndStart}
						disabled={!branchRef}
					>
						<span className="inline-flex items-center">
							<span>Start</span>
							<ButtonShortcut includeShift />
						</span>
					</Button>
				) : null}
			</div>
		</div>
	);
}
