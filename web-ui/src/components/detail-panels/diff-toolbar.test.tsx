import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollapsedDiffToolbar, DiffToolbar } from "@/components/detail-panels/diff-toolbar";

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
	const button = container.querySelector(`button[aria-label="${label}"]`);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Button with aria-label "${label}" was not rendered.`);
	}
	return button;
}

describe("DiffToolbar", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("switches modes and exposes the collapse action", () => {
		const onModeChange = vi.fn();
		const onCollapse = vi.fn();

		act(() => {
			root.render(
				<DiffToolbar
					mode="working_copy"
					onModeChange={onModeChange}
					isExpanded={false}
					onToggleExpand={() => {}}
					onCollapse={onCollapse}
				/>,
			);
		});

		const lastTurnButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Last Turn",
		);
		if (!(lastTurnButton instanceof HTMLButtonElement)) {
			throw new Error("Last Turn button was not rendered.");
		}

		act(() => {
			lastTurnButton.click();
			getButton(container, "Collapse diff viewer").click();
		});

		expect(onModeChange).toHaveBeenCalledWith("last_turn");
		expect(onCollapse).toHaveBeenCalledOnce();
	});

	it("shows the active mode while collapsed and expands from the compact rail", () => {
		const onExpand = vi.fn();

		act(() => {
			root.render(<CollapsedDiffToolbar mode="last_turn" onExpand={onExpand} />);
		});

		expect(container.textContent).toContain("Last Turn");
		act(() => {
			getButton(container, "Expand diff viewer (Last Turn)").click();
		});
		expect(onExpand).toHaveBeenCalledOnce();
	});
});
