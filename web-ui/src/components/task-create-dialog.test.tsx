import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCreateDialog } from "@/components/task-create-dialog";

function Harness({ onStart = () => null }: { onStart?: () => string | null }): React.ReactElement {
	const [prompt, setPrompt] = useState("");
	return (
		<TaskCreateDialog
			open
			onOpenChange={() => {}}
			prompt={prompt}
			onPromptChange={setPrompt}
			images={[]}
			onImagesChange={() => {}}
			onCreateStartAndOpen={onStart}
			workspaceId={null}
			canStart
		/>
	);
}

describe("TaskCreateDialog", () => {
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

	it("opens directly into the prompt without advanced task settings", async () => {
		await act(async () => {
			root.render(<Harness />);
		});
		await act(async () => {
			await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
		});

		const promptInput = document.body.querySelector<HTMLTextAreaElement>("textarea");
		expect(promptInput).not.toBeNull();
		expect(document.activeElement).toBe(promptInput);
		expect(document.body.textContent).not.toContain("Start in plan mode");
		expect(document.body.textContent).not.toContain("Worktree base ref");
		expect(document.body.textContent).not.toContain("Title");
	});

	it("starts and opens the task from the primary action", async () => {
		const onStart = vi.fn(() => "task-1");
		await act(async () => {
			root.render(<Harness onStart={onStart} />);
		});

		const promptInput = document.body.querySelector<HTMLTextAreaElement>("textarea");
		if (!promptInput) {
			throw new Error("Expected task prompt input.");
		}
		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			valueSetter?.call(promptInput, "Implement the prompt-first task flow");
			promptInput.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const startButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Start task"),
		);
		expect(startButton).toBeDefined();
		await act(async () => {
			startButton?.click();
		});

		expect(onStart).toHaveBeenCalledOnce();
	});
});
