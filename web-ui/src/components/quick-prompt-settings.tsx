import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { RuntimeQuickPrompt, RuntimeQuickPromptContext } from "@/runtime/types";

const QUICK_PROMPT_CONTEXT_OPTIONS: ReadonlyArray<{
	value: RuntimeQuickPromptContext;
	label: string;
}> = [
	{ value: "any", label: "In Progress & Review" },
	{ value: "in_progress", label: "In Progress only" },
	{ value: "review", label: "Review only" },
];

function getNextQuickPromptLabel(quickPrompts: readonly RuntimeQuickPrompt[]): string {
	const baseLabel = "Quick prompt";
	const labels = new Set(quickPrompts.map((item) => item.label.trim().toLowerCase()));
	if (!labels.has(baseLabel.toLowerCase())) {
		return baseLabel;
	}
	let suffix = 2;
	while (labels.has(`${baseLabel.toLowerCase()} ${suffix}`)) {
		suffix += 1;
	}
	return `${baseLabel} ${suffix}`;
}

export function QuickPromptSettings({
	quickPrompts,
	onChange,
	disabled,
}: {
	quickPrompts: RuntimeQuickPrompt[];
	onChange: (quickPrompts: RuntimeQuickPrompt[]) => void;
	disabled: boolean;
}): React.ReactElement {
	return (
		<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4">
			<div className="flex items-center justify-between gap-3 mb-2">
				<p className="text-text-secondary text-[13px] m-0">
					Send reusable prompts to an active agent session with one click. They are available in all projects.
				</p>
				<Button
					variant="ghost"
					size="sm"
					icon={<Plus size={14} />}
					onClick={() =>
						onChange([
							...quickPrompts,
							{ label: getNextQuickPromptLabel(quickPrompts), prompt: "", context: "any" },
						])
					}
					disabled={disabled}
				>
					Add
				</Button>
			</div>

			<div className="flex flex-col gap-2">
				{quickPrompts.map((quickPrompt, quickPromptIndex) => (
					<div key={quickPromptIndex} className="rounded-md border border-border bg-surface-1 p-2.5">
						<div className="grid grid-cols-1 gap-2 mb-2 sm:grid-cols-[minmax(0,1fr)_minmax(160px,auto)_auto]">
							<input
								aria-label={`Quick prompt ${quickPromptIndex + 1} label`}
								value={quickPrompt.label}
								onChange={(event) =>
									onChange(
										quickPrompts.map((item, itemIndex) =>
											itemIndex === quickPromptIndex ? { ...item, label: event.target.value } : item,
										),
									)
								}
								placeholder="Button label"
								disabled={disabled}
								className="h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
							/>
							<NativeSelect
								aria-label={`Quick prompt ${quickPromptIndex + 1} context`}
								value={quickPrompt.context}
								onChange={(event) =>
									onChange(
										quickPrompts.map((item, itemIndex) =>
											itemIndex === quickPromptIndex
												? { ...item, context: event.target.value as RuntimeQuickPromptContext }
												: item,
										),
									)
								}
								disabled={disabled}
							>
								{QUICK_PROMPT_CONTEXT_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</NativeSelect>
							<Button
								variant="ghost"
								size="sm"
								icon={<X size={14} />}
								aria-label={`Remove quick prompt ${quickPrompt.label}`}
								onClick={() => onChange(quickPrompts.filter((_, itemIndex) => itemIndex !== quickPromptIndex))}
								disabled={disabled}
							/>
						</div>
						<textarea
							aria-label={`Quick prompt ${quickPromptIndex + 1} text`}
							rows={3}
							value={quickPrompt.prompt}
							onChange={(event) =>
								onChange(
									quickPrompts.map((item, itemIndex) =>
										itemIndex === quickPromptIndex ? { ...item, prompt: event.target.value } : item,
									),
								)
							}
							placeholder="Prompt sent to the agent"
							disabled={disabled}
							className="w-full resize-y rounded-md border border-border bg-surface-2 p-2 text-xs leading-5 text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
						/>
					</div>
				))}
			</div>

			{quickPrompts.length === 0 ? (
				<p className="text-text-secondary text-[13px] mb-0">No quick prompts configured.</p>
			) : null}
		</div>
	);
}
