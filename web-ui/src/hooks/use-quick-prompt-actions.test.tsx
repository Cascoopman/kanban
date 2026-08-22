import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuickPromptActions } from "@/hooks/use-quick-prompt-actions";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";

const showAppToastMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/app-toaster", () => ({
	showAppToast: showAppToastMock,
}));

type SendTaskSessionInput = UseTaskSessionsResult["sendTaskSessionInput"];
type QuickPromptHandler = (taskId: string, prompt: string) => Promise<void>;

function HookHarness({
	sendTaskSessionInput,
	onReady,
}: {
	sendTaskSessionInput: SendTaskSessionInput;
	onReady: (sendQuickPrompt: QuickPromptHandler) => void;
}): null {
	const { handleSendQuickPrompt } = useQuickPromptActions({ sendTaskSessionInput });

	useEffect(() => {
		onReady(handleSendQuickPrompt);
	}, [handleSendQuickPrompt, onReady]);

	return null;
}

describe("useQuickPromptActions", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		showAppToastMock.mockReset();
		vi.useFakeTimers();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	async function renderHook(sendTaskSessionInput: SendTaskSessionInput) {
		let sendQuickPrompt: QuickPromptHandler | null = null;
		await act(async () => {
			root.render(
				<HookHarness
					sendTaskSessionInput={sendTaskSessionInput}
					onReady={(handler) => {
						sendQuickPrompt = handler;
					}}
				/>,
			);
			await Promise.resolve();
		});
		if (!sendQuickPrompt) {
			throw new Error("Expected the quick-prompt action to be ready.");
		}
		return sendQuickPrompt as QuickPromptHandler;
	}

	it("pastes and submits a quick prompt to the selected task session", async () => {
		const sendTaskSessionInput = vi.fn(async () => ({ ok: true }));
		const sendQuickPrompt = await renderHook(sendTaskSessionInput);

		await act(async () => {
			const pending = sendQuickPrompt("task-1", "Looks good. Open a PR and merge it.");
			await vi.advanceTimersByTimeAsync(200);
			await pending;
		});

		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(1, "task-1", "Looks good. Open a PR and merge it.", {
			appendNewline: false,
			mode: "paste",
		});
		expect(sendTaskSessionInput).toHaveBeenNthCalledWith(2, "task-1", "\r", { appendNewline: false });
		expect(showAppToastMock).not.toHaveBeenCalled();
	});

	it("does not submit when pasting the prompt fails", async () => {
		const sendTaskSessionInput = vi.fn(async () => ({ ok: false, message: "Session unavailable." }));
		const sendQuickPrompt = await renderHook(sendTaskSessionInput);

		await act(async () => {
			await sendQuickPrompt("task-1", "Continue.");
		});

		expect(sendTaskSessionInput).toHaveBeenCalledOnce();
		expect(showAppToastMock).toHaveBeenCalledWith(
			expect.objectContaining({ intent: "danger", message: "Session unavailable." }),
		);
	});
});
