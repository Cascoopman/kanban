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
		await act(async () => {
			textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
			textarea?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", metaKey: true, shiftKey: true, bubbles: true }),
			);
		});

		expect(onCreate).toHaveBeenCalledTimes(1);
		expect(onCreateAndStart).toHaveBeenCalledTimes(1);
	});
});
