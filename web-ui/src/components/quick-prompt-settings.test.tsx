import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickPromptSettings } from "@/components/quick-prompt-settings";

describe("QuickPromptSettings", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("adds and removes configurable prompt rows", () => {
		const onChange = vi.fn();
		act(() => {
			root.render(<QuickPromptSettings quickPrompts={[]} onChange={onChange} disabled={false} />);
		});

		const addButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Add",
		);
		if (!(addButton instanceof HTMLButtonElement)) {
			throw new Error("Expected the add quick prompt button.");
		}
		act(() => addButton.click());
		expect(onChange).toHaveBeenCalledWith([{ label: "Quick prompt", prompt: "", context: "any" }]);

		onChange.mockClear();
		act(() => {
			root.render(
				<QuickPromptSettings
					quickPrompts={[{ label: "Ship it", prompt: "Looks good. Open a PR and merge it.", context: "review" }]}
					onChange={onChange}
					disabled={false}
				/>,
			);
		});

		const removeButton = container.querySelector('button[aria-label="Remove quick prompt Ship it"]');
		if (!(removeButton instanceof HTMLButtonElement)) {
			throw new Error("Expected the remove quick prompt button.");
		}
		act(() => removeButton.click());
		expect(onChange).toHaveBeenCalledWith([]);
	});
});
