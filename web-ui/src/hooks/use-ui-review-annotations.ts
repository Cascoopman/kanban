import { useCallback } from "react";

import type { UiReviewAnnotation, UiReviewDraft } from "@/review/ui-review-types";
import { useLocalStorageValue } from "@/utils/react-use";

const STORAGE_KEY = "kanban.ui-review.annotations.v1";
const EMPTY_ANNOTATIONS: UiReviewAnnotation[] = [];

function createAnnotationId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useUiReviewAnnotations(): {
	annotations: UiReviewAnnotation[];
	createAnnotation: (draft: UiReviewDraft) => void;
	updateAnnotation: (id: string, draft: UiReviewDraft) => void;
	deleteAnnotation: (id: string) => void;
	clearAnnotations: () => void;
} {
	const [annotations, setAnnotations, removeAnnotations] = useLocalStorageValue(STORAGE_KEY, EMPTY_ANNOTATIONS);

	const createAnnotation = useCallback(
		(draft: UiReviewDraft) => {
			const timestamp = new Date().toISOString();
			setAnnotations((current) => [
				...current,
				{
					...draft,
					id: createAnnotationId(),
					createdAt: timestamp,
					updatedAt: timestamp,
				},
			]);
		},
		[setAnnotations],
	);

	const updateAnnotation = useCallback(
		(id: string, draft: UiReviewDraft) => {
			setAnnotations((current) =>
				current.map((annotation) =>
					annotation.id === id ? { ...annotation, ...draft, updatedAt: new Date().toISOString() } : annotation,
				),
			);
		},
		[setAnnotations],
	);

	const deleteAnnotation = useCallback(
		(id: string) => {
			setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
		},
		[setAnnotations],
	);

	return {
		annotations,
		createAnnotation,
		updateAnnotation,
		deleteAnnotation,
		clearAnnotations: removeAnnotations,
	};
}
