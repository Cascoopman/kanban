import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskCreateDialog } from "@/components/task-create-dialog";

function Harness(): React.ReactElement {
	const [title, setTitle] = useState("New task");
	const [prompt, setPrompt] = useState("");
	return (
		<TaskCreateDialog
			open
			onOpenChange={() => {}}
			title={title}
			onTitleChange={setTitle}
			prompt={prompt}
			onPromptChange={setPrompt}
			images={[]}
			onImagesChange={() => {}}
			onCreate={() => null}
			onCreateMultiple={() => []}
			startInPlanMode={false}
			onStartInPlanModeChange={() => {}}
			autoReviewEnabled={false}
			onAutoReviewEnabledChange={() => {}}
			autoReviewMode="commit"
			onAutoReviewModeChange={() => {}}
			workspaceId={null}
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

	it("opens with the default title focused and selected before the prompt", async () => {
		await act(async () => {
			root.render(<Harness />);
		});
		await act(async () => {
			await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
		});

		const titleInput = document.body.querySelector<HTMLInputElement>('input[value="New task"]');
		const promptInput = document.body.querySelector<HTMLTextAreaElement>("textarea");
		expect(titleInput).not.toBeNull();
		expect(promptInput).not.toBeNull();
		if (!titleInput || !promptInput) {
			throw new Error("Expected the title and prompt fields to render.");
		}
		expect(document.activeElement).toBe(titleInput);
		expect(titleInput.selectionStart).toBe(0);
		expect(titleInput.selectionEnd).toBe("New task".length);
		expect(titleInput.compareDocumentPosition(promptInput) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
	});
});
