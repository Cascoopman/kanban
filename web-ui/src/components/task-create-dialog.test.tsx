import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskCreateDialog } from "@/components/task-create-dialog";

function Harness(): React.ReactElement {
	const [title, setTitle] = useState("");
	return (
		<TaskCreateDialog
			open
			onOpenChange={() => {}}
			title={title}
			onTitleChange={setTitle}
			onCreateAndOpen={() => null}
			startInPlanMode={false}
			onStartInPlanModeChange={() => {}}
			branchRef="main"
			branchOptions={[{ value: "main", label: "main" }]}
			onBranchRefChange={() => {}}
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

	it("opens with an empty title focused and no prompt field", async () => {
		await act(async () => {
			root.render(<Harness />);
		});
		await act(async () => {
			await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
		});

		const titleInput = document.body.querySelector<HTMLInputElement>('input[placeholder="What are you working on?"]');
		const promptInput = document.body.querySelector<HTMLTextAreaElement>("textarea");
		expect(titleInput).not.toBeNull();
		expect(promptInput).toBeNull();
		if (!titleInput) {
			throw new Error("Expected the title field to render.");
		}
		expect(document.activeElement).toBe(titleInput);
		expect(titleInput.selectionStart).toBe(0);
		expect(titleInput.selectionEnd).toBe(0);
		expect(document.body.textContent).toContain("Create and open terminal");
		expect(document.body.textContent).not.toContain("Create more");
	});
});
