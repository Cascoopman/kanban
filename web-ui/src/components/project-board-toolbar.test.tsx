import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectBoardToolbar } from "@/components/project-board-toolbar";
import type { RuntimeProjectSummary } from "@/runtime/types";

function createProject(id: string, inProgressTasks: number): RuntimeProjectSummary {
	return {
		id,
		name: id,
		path: `/repos/${id}`,
		taskCounts: {
			in_progress: inProgressTasks,
			review: 0,
			on_hold: 0,
			trash: 0,
		},
	};
}

describe("ProjectBoardToolbar", () => {
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

	it("opens settings from the board toolbar", async () => {
		const onOpenSettings = vi.fn();
		await act(async () => {
			root.render(
				<ProjectBoardToolbar
					projects={[]}
					visibleProjectIds={new Set()}
					onVisibleProjectIdsChange={() => {}}
					onAddProject={() => {}}
					onRemoveProject={async () => true}
					onCreateTask={() => {}}
					onOpenSettings={onOpenSettings}
					removingProjectId={null}
				/>,
			);
		});

		const settingsButton = container.querySelector('button[aria-label="Settings"]');
		expect(settingsButton).toBeInstanceOf(HTMLButtonElement);
		act(() => (settingsButton as HTMLButtonElement | null)?.click());
		expect(onOpenSettings).toHaveBeenCalledOnce();
	});

	it("replaces the current project filter when another project is selected", async () => {
		const onVisibleProjectIdsChange = vi.fn();
		await act(async () => {
			root.render(
				<ProjectBoardToolbar
					projects={[createProject("kanban", 1), createProject("llm-wiki", 0)]}
					visibleProjectIds={new Set(["kanban"])}
					onVisibleProjectIdsChange={onVisibleProjectIdsChange}
					onAddProject={() => {}}
					onRemoveProject={async () => true}
					onCreateTask={() => {}}
					onOpenSettings={() => {}}
					removingProjectId={null}
				/>,
			);
		});

		const llmWikiButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "llm-wiki",
		);
		expect(llmWikiButton).toBeInstanceOf(HTMLButtonElement);
		act(() => llmWikiButton?.click());

		expect(onVisibleProjectIdsChange).toHaveBeenCalledOnce();
		const selectedProjectIds = onVisibleProjectIdsChange.mock.calls[0]?.[0];
		expect(selectedProjectIds).toBeInstanceOf(Set);
		expect([...(selectedProjectIds ?? [])]).toEqual(["llm-wiki"]);
	});
});
