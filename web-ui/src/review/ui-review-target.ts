import type { UiReviewTarget } from "@/review/ui-review-types";

const REVIEW_UI_SELECTOR = "[data-ui-review-root]";
const MAX_TEXT_LENGTH = 120;
const MAX_SELECTOR_DEPTH = 6;

function escapeCssIdentifier(value: string): string {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
		return CSS.escape(value);
	}
	return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function isUniqueSelector(selector: string): boolean {
	try {
		return document.querySelectorAll(selector).length === 1;
	} catch {
		return false;
	}
}

function getStableAttributeSelector(element: Element): string | null {
	for (const attribute of ["data-review-id", "data-testid", "aria-label", "name"] as const) {
		const value = element.getAttribute(attribute);
		if (!value) {
			continue;
		}
		const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		const selector = `${element.tagName.toLowerCase()}[${attribute}="${escapedValue}"]`;
		if (isUniqueSelector(selector)) {
			return selector;
		}
	}
	return null;
}

function getSelectorSegment(element: Element): string {
	const tagName = element.tagName.toLowerCase();
	const parent = element.parentElement;
	if (!parent) {
		return tagName;
	}

	const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
	if (sameTagSiblings.length === 1) {
		return tagName;
	}
	return `${tagName}:nth-of-type(${sameTagSiblings.indexOf(element) + 1})`;
}

export function createElementSelector(element: Element): string {
	if (element.id) {
		const idSelector = `#${escapeCssIdentifier(element.id)}`;
		if (isUniqueSelector(idSelector)) {
			return idSelector;
		}
	}

	const stableAttributeSelector = getStableAttributeSelector(element);
	if (stableAttributeSelector) {
		return stableAttributeSelector;
	}

	const segments: string[] = [];
	let current: Element | null = element;
	while (current && segments.length < MAX_SELECTOR_DEPTH) {
		if (current.id) {
			segments.unshift(`#${escapeCssIdentifier(current.id)}`);
			break;
		}
		segments.unshift(getSelectorSegment(current));
		const selector = segments.join(" > ");
		if (isUniqueSelector(selector)) {
			return selector;
		}
		current = current.parentElement;
	}
	return segments.join(" > ");
}

function getTargetLabel(element: Element): string {
	const explicitLabel =
		element.getAttribute("data-review-label") ??
		element.getAttribute("aria-label") ??
		element.getAttribute("title") ??
		element.getAttribute("placeholder");
	if (explicitLabel) {
		return normalizeText(explicitLabel);
	}

	const text = normalizeText(element.textContent);
	if (text) {
		return text;
	}

	const role = element.getAttribute("role");
	return role ? `${role} element` : `${element.tagName.toLowerCase()} element`;
}

export function normalizeReviewElement(target: EventTarget | null): Element | null {
	if (!(target instanceof Element) || target.closest(REVIEW_UI_SELECTOR)) {
		return null;
	}
	return (
		target.closest("button, a, input, textarea, select, [role], [aria-label], [data-review-label], [data-testid]") ??
		target
	);
}

export function createReviewTarget(element: Element): UiReviewTarget {
	return {
		selector: createElementSelector(element),
		label: getTargetLabel(element),
		tagName: element.tagName.toLowerCase(),
		text: normalizeText(element.textContent),
		pagePath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight,
	};
}

export function resolveReviewTargetElement(target: UiReviewTarget): Element | null {
	try {
		return document.querySelector(target.selector);
	} catch {
		return null;
	}
}
