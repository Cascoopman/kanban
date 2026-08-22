import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildThemedVsCodeWebUrl, VscodeInlinePanel } from "@/components/detail-panels/vscode-inline-panel";

const mocks = vi.hoisted(() => ({
	startVsCodeWeb: vi.fn(),
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			startVsCodeWeb: {
				mutate: mocks.startVsCodeWeb,
			},
		},
	}),
}));

describe("VscodeInlinePanel", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mocks.startVsCodeWeb.mockReset();
		mocks.startVsCodeWeb.mockResolvedValue({
			status: "ready",
			url: "http://127.0.0.1:41001/vscode/",
			workspacePath: "/tmp/project",
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
	});

	it("starts automatically without asking for license confirmation", async () => {
		await act(async () => {
			root.render(<VscodeInlinePanel taskId="task-1" baseRef="main" workspaceId="workspace-1" />);
		});

		expect(mocks.startVsCodeWeb).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "main",
			acceptLicenseTerms: true,
		});
		expect(container.textContent).not.toContain("Accept and start VS Code");
		expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
			"http://127.0.0.1:41001/vscode/?kanban-vscode-theme=Dark+Modern",
		);
	});

	it("maps Kanban themes to the closest built-in VS Code theme", () => {
		expect(buildThemedVsCodeWebUrl("http://127.0.0.1:41001/vscode/?tkn=secret", "solarized-dark")).toBe(
			"http://127.0.0.1:41001/vscode/?tkn=secret&kanban-vscode-theme=Solarized+Dark",
		);
		expect(buildThemedVsCodeWebUrl("http://127.0.0.1:41001/vscode/", "high-contrast-light")).toBe(
			"http://127.0.0.1:41001/vscode/?kanban-vscode-theme=Default+High+Contrast+Light",
		);
	});
});
