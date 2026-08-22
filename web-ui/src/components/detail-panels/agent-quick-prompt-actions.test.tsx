import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentQuickPromptActions } from "@/components/detail-panels/agent-quick-prompt-actions";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("AgentQuickPromptActions", () => {
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

	it("shows prompts for the current context and sends the selected prompt", async () => {
		const onSend = vi.fn(async () => {});
		await act(async () => {
			root.render(
				<TooltipProvider>
					<AgentQuickPromptActions
						quickPrompts={[
							{ label: "Continue", prompt: "Please continue.", context: "any" },
							{ label: "Ship it", prompt: "Open a PR and merge it.", context: "review" },
							{ label: "Investigate", prompt: "Investigate the failure.", context: "in_progress" },
						]}
						columnId="review"
						disabled={false}
						onSend={onSend}
						onEdit={() => {}}
					/>
				</TooltipProvider>,
			);
		});

		expect(container.textContent).toContain("Continue");
		expect(container.textContent).toContain("Ship it");
		expect(container.textContent).not.toContain("Investigate");

		const shipButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Ship it",
		);
		if (!(shipButton instanceof HTMLButtonElement)) {
			throw new Error("Expected the review quick prompt button.");
		}
		await act(async () => shipButton.click());

		expect(onSend).toHaveBeenCalledWith("Open a PR and merge it.");
	});

	it("offers quick prompt setup when none are configured", () => {
		const onEdit = vi.fn();
		act(() => {
			root.render(
				<TooltipProvider>
					<AgentQuickPromptActions
						quickPrompts={[]}
						columnId="in_progress"
						disabled
						onSend={async () => {}}
						onEdit={onEdit}
					/>
				</TooltipProvider>,
			);
		});

		const addButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Add quick prompt",
		);
		if (!(addButton instanceof HTMLButtonElement)) {
			throw new Error("Expected an add quick prompt button.");
		}
		act(() => addButton.click());
		expect(onEdit).toHaveBeenCalledOnce();
	});
});
