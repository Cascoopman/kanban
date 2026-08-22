export const UI_REVIEW_CATEGORIES = [
	"Visual design",
	"Layout",
	"Copy",
	"Interaction",
	"Accessibility",
	"Performance",
	"Other",
] as const;

export const UI_REVIEW_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;

export type UiReviewCategory = (typeof UI_REVIEW_CATEGORIES)[number];
export type UiReviewPriority = (typeof UI_REVIEW_PRIORITIES)[number];
export type UiReviewScore = 1 | 2 | 3 | 4 | 5;

export interface UiReviewTarget {
	selector: string;
	label: string;
	tagName: string;
	text: string;
	pagePath: string;
	viewportWidth: number;
	viewportHeight: number;
}

export interface UiReviewAnnotation {
	id: string;
	target: UiReviewTarget;
	category: UiReviewCategory;
	priority: UiReviewPriority;
	score: UiReviewScore;
	observation: string;
	suggestion: string;
	createdAt: string;
	updatedAt: string;
}

export interface UiReviewDraft {
	target: UiReviewTarget;
	category: UiReviewCategory;
	priority: UiReviewPriority;
	score: UiReviewScore;
	observation: string;
	suggestion: string;
}
