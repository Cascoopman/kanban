import { Clipboard, ListChecks, MessageSquarePlus, MousePointer2, X } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { UiReviewEditorDialog } from "@/components/ui-review-editor-dialog";
import { UiReviewPanel } from "@/components/ui-review-panel";
import { useUiReviewAnnotations } from "@/hooks/use-ui-review-annotations";
import { createUiReviewReport } from "@/review/ui-review-report";
import { createReviewTarget, normalizeReviewElement, resolveReviewTargetElement } from "@/review/ui-review-target";
import type { UiReviewAnnotation, UiReviewDraft, UiReviewTarget } from "@/review/ui-review-types";
import { useDocumentEvent, useWindowEvent } from "@/utils/react-use";

const DEFAULT_DRAFT_FIELDS = {
	category: "Visual design",
	priority: "Medium",
	score: 3,
	observation: "",
	suggestion: "",
} as const;

interface MarkerPosition {
	id: string;
	top: number;
	left: number;
}

async function copyText(value: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}
	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.select();
	document.execCommand("copy");
	textarea.remove();
}

function downloadReport(report: string): void {
	const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `ui-feedback-${new Date().toISOString().slice(0, 10)}.md`;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function UiReviewOverlay(): ReactElement {
	const { annotations, createAnnotation, updateAnnotation, deleteAnnotation, clearAnnotations } =
		useUiReviewAnnotations();
	const [isSelecting, setIsSelecting] = useState(false);
	const [isPanelOpen, setIsPanelOpen] = useState(false);
	const [hoveredElement, setHoveredElement] = useState<Element | null>(null);
	const [draft, setDraft] = useState<UiReviewDraft | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
	const [layoutRevision, setLayoutRevision] = useState(0);

	const report = useMemo(() => createUiReviewReport(annotations), [annotations]);
	const hoveredRect = hoveredElement?.getBoundingClientRect() ?? null;
	const markerPositions = useMemo<MarkerPosition[]>(() => {
		return annotations.flatMap((annotation) => {
			const element = resolveReviewTargetElement(annotation.target);
			if (!element) {
				return [];
			}
			const rect = element.getBoundingClientRect();
			return [{ id: annotation.id, top: rect.top - 9, left: rect.right - 9 }];
		});
	}, [annotations, layoutRevision]);

	const openDraftForTarget = useCallback((target: UiReviewTarget) => {
		setEditingId(null);
		setIsPanelOpen(false);
		setDraft({ target, ...DEFAULT_DRAFT_FIELDS });
	}, []);

	useDocumentEvent(
		"pointermove",
		isSelecting && !draft && !isClearConfirmOpen
			? (event) => setHoveredElement(normalizeReviewElement(event.target))
			: null,
		true,
	);
	useDocumentEvent(
		"click",
		isSelecting && !draft && !isClearConfirmOpen
			? (event) => {
					const element = normalizeReviewElement(event.target);
					if (!element) {
						return;
					}
					event.preventDefault();
					event.stopImmediatePropagation();
					setHoveredElement(null);
					openDraftForTarget(createReviewTarget(element));
				}
			: null,
		true,
	);
	useDocumentEvent("keydown", (event) => {
		if (event.key === "Escape" && isSelecting && !draft) {
			setIsSelecting(false);
			setHoveredElement(null);
		}
	});
	useWindowEvent("resize", () => setLayoutRevision((revision) => revision + 1));
	useWindowEvent("scroll", () => setLayoutRevision((revision) => revision + 1), true);

	useEffect(() => {
		if (!isSelecting) {
			setHoveredElement(null);
		}
	}, [isSelecting]);

	const handleSave = (nextDraft: UiReviewDraft) => {
		if (editingId) {
			updateAnnotation(editingId, nextDraft);
		} else {
			createAnnotation(nextDraft);
		}
		setDraft(null);
		setEditingId(null);
		setIsPanelOpen(true);
	};

	const handleEdit = (annotation: UiReviewAnnotation) => {
		setIsPanelOpen(false);
		setEditingId(annotation.id);
		setDraft({
			target: annotation.target,
			category: annotation.category,
			priority: annotation.priority,
			score: annotation.score,
			observation: annotation.observation,
			suggestion: annotation.suggestion,
		});
	};

	const handleCopy = async () => {
		try {
			await copyText(report);
			toast.success("UI feedback report copied");
		} catch {
			toast.error("Could not copy the feedback report");
		}
	};

	const handleClear = () => {
		clearAnnotations();
		setIsClearConfirmOpen(false);
	};

	return (
		<>
			{!draft && !isClearConfirmOpen ? (
				<div data-ui-review-root className="fixed bottom-3 left-3 z-[69] flex items-center gap-2">
					{isSelecting ? (
						<div className="flex items-center gap-2 rounded-xl border border-accent/60 bg-surface-1 p-2 shadow-2xl">
							<div className="flex items-center gap-2 px-1 text-xs font-medium text-text-primary">
								<MousePointer2 size={14} className="text-accent" />
								Click an element to annotate
							</div>
							<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setIsSelecting(false)}>
								Stop
							</Button>
						</div>
					) : (
						<Button
							variant="primary"
							icon={<MessageSquarePlus size={15} />}
							onClick={() => setIsSelecting(true)}
							className="shadow-xl"
						>
							Review UI
						</Button>
					)}
					<Button
						variant="default"
						icon={<ListChecks size={15} />}
						onClick={() => setIsPanelOpen((open) => !open)}
						className="shadow-xl"
					>
						{annotations.length}
					</Button>
					{annotations.length > 0 ? (
						<Button variant="default" icon={<Clipboard size={14} />} onClick={handleCopy} className="shadow-xl">
							Copy report
						</Button>
					) : null}
				</div>
			) : null}

			{isSelecting && !isClearConfirmOpen && hoveredRect ? (
				<div
					data-ui-review-root
					className="pointer-events-none fixed z-[68] rounded-sm border-2 border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(0,0,0,0.7)]"
					style={{
						top: hoveredRect.top,
						left: hoveredRect.left,
						width: hoveredRect.width,
						height: hoveredRect.height,
					}}
				/>
			) : null}

			{isSelecting && !draft && !isClearConfirmOpen
				? markerPositions.map((position, index) => (
						<button
							key={position.id}
							data-ui-review-root
							type="button"
							aria-label={`Edit annotation ${index + 1}`}
							className="fixed z-[69] flex size-5 items-center justify-center rounded-full border border-white/70 bg-accent text-[10px] font-bold text-accent-fg shadow-lg"
							style={{ top: position.top, left: position.left }}
							onClick={() => {
								const annotation = annotations.find((item) => item.id === position.id);
								if (annotation) handleEdit(annotation);
							}}
						>
							{index + 1}
						</button>
					))
				: null}

			{isPanelOpen && !draft ? (
				<UiReviewPanel
					annotations={annotations}
					onClose={() => setIsPanelOpen(false)}
					onCopy={handleCopy}
					onDownload={() => downloadReport(report)}
					onEdit={handleEdit}
					onDelete={deleteAnnotation}
					onClear={() => {
						setIsPanelOpen(false);
						setIsClearConfirmOpen(true);
					}}
				/>
			) : null}

			<UiReviewEditorDialog
				draft={draft}
				isEditing={editingId !== null}
				onCancel={() => {
					setDraft(null);
					setEditingId(null);
				}}
				onSave={handleSave}
			/>

			<AlertDialog open={isClearConfirmOpen} onOpenChange={setIsClearConfirmOpen}>
				<AlertDialogHeader>
					<AlertDialogTitle>Clear all UI feedback?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						This permanently removes every annotation stored in this browser.
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="default">Cancel</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button variant="danger" onClick={handleClear}>
							Clear all
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</>
	);
}
