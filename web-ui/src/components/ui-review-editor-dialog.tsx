import { MessageSquareText } from "lucide-react";
import { type FormEvent, type ReactElement, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import {
	UI_REVIEW_CATEGORIES,
	UI_REVIEW_PRIORITIES,
	type UiReviewDraft,
	type UiReviewScore,
} from "@/review/ui-review-types";

const textareaClassName =
	"min-h-24 w-full resize-y rounded-md border border-border-bright bg-surface-2 px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none";

export function UiReviewEditorDialog({
	draft,
	isEditing,
	onCancel,
	onSave,
}: {
	draft: UiReviewDraft | null;
	isEditing: boolean;
	onCancel: () => void;
	onSave: (draft: UiReviewDraft) => void;
}): ReactElement {
	const [formDraft, setFormDraft] = useState<UiReviewDraft | null>(draft);

	useEffect(() => {
		setFormDraft(draft);
	}, [draft]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!formDraft?.observation.trim()) {
			return;
		}
		onSave({
			...formDraft,
			observation: formDraft.observation.trim(),
			suggestion: formDraft.suggestion.trim(),
		});
	};

	return (
		<Dialog open={formDraft !== null} onOpenChange={(open) => !open && onCancel()} contentAriaDescribedBy={undefined}>
			<DialogHeader
				title={isEditing ? "Edit UI annotation" : "Annotate UI element"}
				icon={<MessageSquareText size={16} />}
			/>
			{formDraft ? (
				<form onSubmit={handleSubmit} className="contents">
					<DialogBody className="space-y-4">
						<div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2">
							<p className="truncate text-sm font-medium text-text-primary">{formDraft.target.label}</p>
							<code className="mt-1 block truncate text-[11px] text-text-secondary">
								{formDraft.target.selector}
							</code>
						</div>

						<div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
							<label
								htmlFor="ui-review-category"
								className="space-y-1.5 text-xs font-medium text-text-secondary"
							>
								Category
								<NativeSelect
									id="ui-review-category"
									fill
									value={formDraft.category}
									onChange={(event) =>
										setFormDraft({ ...formDraft, category: event.target.value as UiReviewDraft["category"] })
									}
								>
									{UI_REVIEW_CATEGORIES.map((category) => (
										<option key={category}>{category}</option>
									))}
								</NativeSelect>
							</label>
							<label
								htmlFor="ui-review-priority"
								className="space-y-1.5 text-xs font-medium text-text-secondary"
							>
								Priority
								<NativeSelect
									id="ui-review-priority"
									fill
									value={formDraft.priority}
									onChange={(event) =>
										setFormDraft({ ...formDraft, priority: event.target.value as UiReviewDraft["priority"] })
									}
								>
									{UI_REVIEW_PRIORITIES.map((priority) => (
										<option key={priority}>{priority}</option>
									))}
								</NativeSelect>
							</label>
							<label htmlFor="ui-review-score" className="space-y-1.5 text-xs font-medium text-text-secondary">
								Score
								<NativeSelect
									id="ui-review-score"
									fill
									value={formDraft.score}
									onChange={(event) =>
										setFormDraft({ ...formDraft, score: Number(event.target.value) as UiReviewScore })
									}
								>
									{[1, 2, 3, 4, 5].map((score) => (
										<option key={score} value={score}>
											{score}/5
										</option>
									))}
								</NativeSelect>
							</label>
						</div>

						<label
							htmlFor="ui-review-observation"
							className="block space-y-1.5 text-xs font-medium text-text-secondary"
						>
							Observation <span className="text-status-red">*</span>
							<textarea
								id="ui-review-observation"
								autoFocus
								required
								className={textareaClassName}
								placeholder="What is unclear, inconsistent, broken, or especially effective?"
								value={formDraft.observation}
								onChange={(event) => setFormDraft({ ...formDraft, observation: event.target.value })}
							/>
						</label>

						<label
							htmlFor="ui-review-suggestion"
							className="block space-y-1.5 text-xs font-medium text-text-secondary"
						>
							Suggested change
							<textarea
								id="ui-review-suggestion"
								className={textareaClassName}
								placeholder="Describe the desired outcome or implementation direction."
								value={formDraft.suggestion}
								onChange={(event) => setFormDraft({ ...formDraft, suggestion: event.target.value })}
							/>
						</label>
					</DialogBody>
					<DialogFooter>
						<Button variant="default" onClick={onCancel}>
							Cancel
						</Button>
						<Button variant="primary" type="submit" disabled={!formDraft.observation.trim()}>
							{isEditing ? "Save changes" : "Add annotation"}
						</Button>
					</DialogFooter>
				</form>
			) : null}
		</Dialog>
	);
}
