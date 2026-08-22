import { beforeEach, describe, expect, it } from "vitest";

import { createElementSelector, createReviewTarget, normalizeReviewElement } from "@/review/ui-review-target";

describe("UI review element targeting", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("prefers stable accessible selectors", () => {
		document.body.innerHTML = '<button aria-label="Settings"><svg><path /></svg></button>';
		const path = document.querySelector("path");
		const button = document.querySelector("button");

		expect(normalizeReviewElement(path)).toBe(button);
		expect(createElementSelector(button as HTMLButtonElement)).toBe('button[aria-label="Settings"]');
	});

	it("captures useful target metadata", () => {
		document.body.innerHTML = '<main><button id="create-task">Create task</button></main>';
		const button = document.querySelector("button");
		const target = createReviewTarget(button as HTMLButtonElement);

		expect(target.selector).toBe("#create-task");
		expect(target.label).toBe("Create task");
		expect(target.tagName).toBe("button");
	});

	it("ignores the review controls themselves", () => {
		document.body.innerHTML = "<div data-ui-review-root><button>Review UI</button></div>";
		const button = document.querySelector("button");

		expect(normalizeReviewElement(button)).toBeNull();
	});
});
