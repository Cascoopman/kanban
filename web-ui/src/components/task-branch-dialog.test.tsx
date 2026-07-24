import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBranchDialog } from "@/components/task-branch-dialog";
import type { BoardCard } from "@/types";

const sourceTask: BoardCard = {
	id: "source-task",
	title: "Source task",
	prompt: "Original work",
	startInPlanMode: false,
	autoReviewEnabled: false,
	autoReviewMode: "commit",
	baseRef: "main",
	createdAt: 1,
	updatedAt: 1,
};

describe("TaskBranchDialog", () => {
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

	it("offers create and create-and-start actions with keyboard shortcuts", async () => {
		const onCreate = vi.fn();
		const onCreateAndStart = vi.fn();
		await act(async () => {
			root.render(
				<TaskBranchDialog
					open
					sourceTask={sourceTask}
					title="New task"
					onTitleChange={() => {}}
					prompt="Try another approach"
					onPromptChange={() => {}}
					isPending={false}
					onOpenChange={() => {}}
					onCreate={onCreate}
					onCreateAndStart={onCreateAndStart}
				/>,
			);
		});

		const textarea = document.body.querySelector("textarea");
		expect(document.body.textContent).toContain("Create task");
		expect(document.body.textContent).toContain("Create & start");
		const buttons = Array.from(document.body.querySelectorAll("button"));
		const createButton = buttons.find((button) => button.textContent?.includes("Create task"));
		const createAndStartButton = buttons.find((button) => button.textContent?.includes("Create & start"));
		expect(createButton?.querySelector(".lucide-command")).not.toBeNull();
		expect(createButton?.querySelector(".lucide-corner-down-left")).not.toBeNull();
		expect(createAndStartButton?.querySelector(".lucide-command")).not.toBeNull();
		expect(createAndStartButton?.querySelector(".lucide-arrow-big-up")).not.toBeNull();
		expect(createAndStartButton?.querySelector(".lucide-corner-down-left")).not.toBeNull();
		await act(async () => {
			textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
			textarea?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", metaKey: true, shiftKey: true, bubbles: true }),
			);
			textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
			textarea?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, shiftKey: true, bubbles: true }),
			);
		});

		expect(onCreate).toHaveBeenCalledTimes(2);
		expect(onCreateAndStart).toHaveBeenCalledTimes(2);
	});

	it("opens with the title focused and selected before the prompt", async () => {
		await act(async () => {
			root.render(
				<TaskBranchDialog
					open
					sourceTask={sourceTask}
					title="New task"
					onTitleChange={() => {}}
					prompt=""
					onPromptChange={() => {}}
					isPending={false}
					onOpenChange={() => {}}
					onCreate={() => {}}
					onCreateAndStart={() => {}}
				/>,
			);
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
