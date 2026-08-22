import { describe, expect, it } from "vitest";

import { createUiReviewReport } from "@/review/ui-review-report";
import type { UiReviewAnnotation } from "@/review/ui-review-types";

function createAnnotation(overrides: Partial<UiReviewAnnotation> = {}): UiReviewAnnotation {
	return {
		id: "annotation-1",
		target: {
			selector: 'button[aria-label="Settings"]',
			label: "Settings",
			tagName: "button",
			text: "",
			pagePath: "/board",
			viewportWidth: 1440,
			viewportHeight: 900,
		},
		category: "Interaction",
		priority: "High",
		score: 2,
		observation: "The control is difficult to discover.",
		suggestion: "Add a persistent label.",
		createdAt: "2026-08-22T09:00:00.000Z",
		updatedAt: "2026-08-22T09:00:00.000Z",
		...overrides,
	};
}

describe("createUiReviewReport", () => {
	it("creates an actionable Markdown report", () => {
		const report = createUiReviewReport([createAnnotation()], new Date("2026-08-22T10:00:00.000Z"));

		expect(report).toContain("# UI feedback report");
		expect(report).toContain("Total annotations: 1");
		expect(report).toContain("Average quality score: 2.0/5");
		expect(report).toContain("[High] Interaction — Settings");
		expect(report).toContain("The control is difficult to discover.");
		expect(report).toContain("Add a persistent label.");
	});

	it("sorts critical feedback before lower priorities", () => {
		const report = createUiReviewReport([
			createAnnotation({ id: "low", priority: "Low", observation: "Low issue" }),
			createAnnotation({ id: "critical", priority: "Critical", observation: "Critical issue" }),
		]);

		expect(report.indexOf("Critical issue")).toBeLessThan(report.indexOf("Low issue"));
	});
});
