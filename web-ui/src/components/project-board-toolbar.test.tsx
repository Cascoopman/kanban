import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectBoardToolbar } from "@/components/project-board-toolbar";

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
});
