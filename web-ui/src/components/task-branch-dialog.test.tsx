import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBranchDialog } from "@/components/task-branch-dialog";
import type { BoardCard } from "@/types";

const sourceTask: BoardCard = {
	id: "source-task",
	title: "Source task",
	startInPlanMode: false,
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

	it("offers one create-and-open action with its keyboard shortcut", async () => {
		const onCreate = vi.fn();
		await act(async () => {
			root.render(
				<TaskBranchDialog
					open
					sourceTask={sourceTask}
					title="New task"
					onTitleChange={() => {}}
					isPending={false}
					onOpenChange={() => {}}
					onCreate={onCreate}
				/>,
			);
		});

		const createButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Create and open terminal"),
		);
		expect(createButton?.querySelector(".lucide-command")).not.toBeNull();
		expect(createButton?.querySelector(".lucide-arrow-big-up")).not.toBeNull();
		expect(createButton?.querySelector(".lucide-corner-down-left")).not.toBeNull();
		await act(async () => createButton?.click());

		expect(onCreate).toHaveBeenCalledOnce();
	});

	it("opens with the title focused and selected", async () => {
		await act(async () => {
			root.render(
				<TaskBranchDialog
					open
					sourceTask={sourceTask}
					title="New task"
					onTitleChange={() => {}}
					isPending={false}
					onOpenChange={() => {}}
					onCreate={() => {}}
				/>,
			);
		});
		await act(async () => {
			await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
		});

		const titleInput = document.body.querySelector<HTMLInputElement>('input[value="New task"]');
		if (!titleInput) {
			throw new Error("Expected the title field to render.");
		}
		expect(document.activeElement).toBe(titleInput);
		expect(titleInput.selectionStart).toBe(0);
		expect(titleInput.selectionEnd).toBe("New task".length);
	});
});
