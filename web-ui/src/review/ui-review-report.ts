import type { UiReviewAnnotation, UiReviewPriority } from "@/review/ui-review-types";

const priorityOrder: Record<UiReviewPriority, number> = {
	Critical: 0,
	High: 1,
	Medium: 2,
	Low: 3,
};

function formatMultiline(value: string): string {
	return value.trim().replace(/\n{3,}/g, "\n\n");
}

function getAverageScore(annotations: UiReviewAnnotation[]): string {
	if (annotations.length === 0) {
		return "n/a";
	}
	const total = annotations.reduce((sum, annotation) => sum + annotation.score, 0);
	return `${(total / annotations.length).toFixed(1)}/5`;
}

export function createUiReviewReport(annotations: UiReviewAnnotation[], generatedAt = new Date()): string {
	const sortedAnnotations = [...annotations].sort((left, right) => {
		const priorityDifference = priorityOrder[left.priority] - priorityOrder[right.priority];
		return priorityDifference || left.createdAt.localeCompare(right.createdAt);
	});
	const priorityCounts = Object.keys(priorityOrder).map((priority) => {
		const count = annotations.filter((annotation) => annotation.priority === priority).length;
		return `- ${priority}: ${count}`;
	});

	const sections = sortedAnnotations.map((annotation, index) => {
		const suggestion = annotation.suggestion.trim()
			? `\n**Suggested change**\n\n${formatMultiline(annotation.suggestion)}\n`
			: "";
		return `## ${index + 1}. [${annotation.priority}] ${annotation.category} — ${annotation.target.label}

- **Quality score:** ${annotation.score}/5
- **Page:** \`${annotation.target.pagePath}\`
- **Element:** \`${annotation.target.selector}\`
- **Viewport:** ${annotation.target.viewportWidth} × ${annotation.target.viewportHeight}

**Observation**

${formatMultiline(annotation.observation)}
${suggestion}`;
	});

	return `# UI feedback report

Generated: ${generatedAt.toISOString()}

## Summary

- Total annotations: ${annotations.length}
- Average quality score: ${getAverageScore(annotations)}
${priorityCounts.join("\n")}

${sections.length > 0 ? sections.join("\n---\n\n") : "No annotations were recorded."}
`;
}
