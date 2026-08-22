import { Clipboard, Download, Pencil, Trash2 } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { UiReviewAnnotation } from "@/review/ui-review-types";

const priorityClassNames: Record<UiReviewAnnotation["priority"], string> = {
	Low: "bg-status-blue/15 text-status-blue",
	Medium: "bg-status-gold/15 text-status-gold",
	High: "bg-status-orange/15 text-status-orange",
	Critical: "bg-status-red/15 text-status-red",
};

export function UiReviewPanel({
	annotations,
	onClose,
	onCopy,
	onDownload,
	onEdit,
	onDelete,
	onClear,
}: {
	annotations: UiReviewAnnotation[];
	onClose: () => void;
	onCopy: () => void;
	onDownload: () => void;
	onEdit: (annotation: UiReviewAnnotation) => void;
	onDelete: (id: string) => void;
	onClear: () => void;
}): ReactElement {
	return (
		<aside
			data-ui-review-root
			className="fixed inset-y-3 right-3 z-[70] flex w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border-bright bg-surface-1 shadow-2xl"
		>
			<header className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-2.5">
				<div>
					<h2 className="text-sm font-semibold text-text-primary">UI feedback</h2>
					<p className="text-[11px] text-text-secondary">{annotations.length} annotations saved locally</p>
				</div>
				<Button variant="ghost" size="sm" onClick={onClose}>
					Close
				</Button>
			</header>

			<div className="flex gap-2 border-b border-border px-3 py-2">
				<Button size="sm" icon={<Clipboard size={14} />} onClick={onCopy} disabled={annotations.length === 0}>
					Copy report
				</Button>
				<Button size="sm" icon={<Download size={14} />} onClick={onDownload} disabled={annotations.length === 0}>
					Download
				</Button>
			</div>

			<div className="flex-1 space-y-2 overflow-y-auto p-3">
				{annotations.length === 0 ? (
					<div className="rounded-lg border border-dashed border-border-bright p-6 text-center">
						<p className="text-sm text-text-primary">No feedback yet</p>
						<p className="mt-1 text-xs text-text-secondary">Turn on selection and click any UI element.</p>
					</div>
				) : (
					annotations.map((annotation, index) => (
						<article key={annotation.id} className="rounded-lg border border-border bg-surface-2 p-3">
							<div className="flex items-start gap-2">
								<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-fg">
									{index + 1}
								</span>
								<div className="min-w-0 flex-1">
									<p className="truncate text-xs font-medium text-text-primary">{annotation.target.label}</p>
									<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
										<span
											className={cn(
												"rounded px-1.5 py-0.5 font-medium",
												priorityClassNames[annotation.priority],
											)}
										>
											{annotation.priority}
										</span>
										<span className="text-text-tertiary">{annotation.category}</span>
										<span className="text-text-tertiary">{annotation.score}/5</span>
									</div>
								</div>
							</div>
							<p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
								{annotation.observation}
							</p>
							<div className="mt-2 flex justify-end gap-1">
								<Button
									variant="ghost"
									size="sm"
									icon={<Pencil size={13} />}
									onClick={() => onEdit(annotation)}
								>
									Edit
								</Button>
								<Button
									variant="ghost"
									size="sm"
									icon={<Trash2 size={13} />}
									onClick={() => onDelete(annotation.id)}
								>
									Delete
								</Button>
							</div>
						</article>
					))
				)}
			</div>

			{annotations.length > 0 ? (
				<footer className="border-t border-border p-2 text-right">
					<Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={onClear}>
						Clear all
					</Button>
				</footer>
			) : null}
		</aside>
	);
}
