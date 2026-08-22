import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardCard } from "@/components/board-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { ReviewTaskWorkspaceSnapshot } from "@/types";

let mockWorkspaceSnapshot: ReviewTaskWorkspaceSnapshot | undefined;

vi.mock("@hello-pangea/dnd", () => ({
	Draggable: ({
		children,
	}: {
		children: (
			provided: {
				innerRef: (element: HTMLDivElement | null) => void;
				draggableProps: object;
				dragHandleProps: object;
			},
			snapshot: { isDragging: boolean },
		) => ReactNode;
	}): React.ReactElement => (
		<>{children({ innerRef: () => {}, draggableProps: {}, dragHandleProps: {} }, { isDragging: false })}</>
	),
}));

vi.mock("@/stores/workspace-metadata-store", () => ({
	useTaskWorkspaceSnapshotValue: () => mockWorkspaceSnapshot,
}));

function createCard(overrides?: Partial<Parameters<typeof BoardCard>[0]["card"]>) {
	return {
		id: "task-1",
		title: "Review API changes",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function createSummary(
	state: RuntimeTaskSessionSummary["state"],
	overrides?: Partial<RuntimeTaskSessionSummary>,
): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "codex",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: 1,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

describe("BoardCard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		mockWorkspaceSnapshot = undefined;
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			width: 240,
			height: 32,
			right: 240,
			bottom: 32,
			toJSON: () => ({}),
		}));
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		vi.restoreAllMocks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("shows a loading state on the review done button while moving to done", async () => {
		await act(async () => {
			root.render(<BoardCard card={createCard()} index={0} columnId="review" isMoveToTrashLoading />);
		});

		const trashButton = container.querySelector('button[aria-label="Move task to done"]');
		expect(trashButton).toBeInstanceOf(HTMLButtonElement);
		expect((trashButton as HTMLButtonElement | null)?.disabled).toBe(true);
		expect(trashButton?.querySelector("svg.animate-spin")).toBeTruthy();
	});

	it("shows a branch button and sends the selected task", async () => {
		const onBranch = vi.fn();
		const card = createCard();
		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={card}
						index={0}
						columnId="in_progress"
						sessionSummary={createSummary("running")}
						onBranch={onBranch}
					/>
				</TooltipProvider>,
			);
		});

		const branchButton = container.querySelector('button[aria-label="Branch task"]');
		expect(branchButton).toBeInstanceOf(HTMLButtonElement);
		expect((branchButton as HTMLButtonElement | null)?.disabled).toBe(false);
		await act(async () => {
			branchButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			(branchButton as HTMLButtonElement | null)?.click();
		});
		expect(onBranch).toHaveBeenCalledWith(card);
	});

	it("does not render the stored prompt as a card description", async () => {
		await act(async () => {
			root.render(<BoardCard card={createCard({ title: "Visible title" })} index={0} columnId="in_progress" />);
		});

		expect(container.textContent).toContain("Visible title");
		expect(container.textContent).not.toContain("Outdated implementation instructions");
	});

	it("reconstructs and shows trashed worktree path when workspace metadata is not tracked", async () => {
		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard({ id: "trash-task-1" })}
						index={0}
						columnId="trash"
						workspacePath="/Users/alice/projects/kanban"
					/>
				</TooltipProvider>,
			);
		});

		expect(container.textContent).toContain("~/.kanban/worktrees/trash-task-1/kanban");
	});

	it("shows tool input details in the session preview text", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={{
						taskId: "task-1",
						state: "running",
						agentId: "codex",
						workspacePath: "/tmp/worktree",
						pid: null,
						startedAt: Date.now(),
						updatedAt: Date.now(),
						lastOutputAt: Date.now(),
						reviewReason: null,
						exitCode: null,
						lastHookAt: Date.now(),
						latestHookActivity: {
							activityText: "Using Read",
							toolName: "Read",
							toolInputSummary: "src/index.ts",
							finalMessage: null,
							hookEventName: "tool_call",
							notificationType: null,
							source: "codex",
						},
						latestTurnCheckpoint: null,
						previousTurnCheckpoint: null,
					}}
				/>,
			);
		});

		expect(container.textContent).toContain("Read: src/index.ts");
		expect(container.textContent).not.toContain("Using Read");
	});

	it("shows tool activity in the compact tool label format", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "claude",
						latestHookActivity: {
							activityText: "Completed Read: src/index.ts",
							toolName: "Read",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "tool_result",
							notificationType: null,
							source: "claude",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Read: src/index.ts");
		expect(container.textContent).not.toContain("Completed Read");
	});

	it("keeps canonical tool names in the session preview label", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "claude",
						latestHookActivity: {
							activityText: "Using fs_write: src/index.ts",
							toolName: "fs_write",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "preToolUse",
							notificationType: null,
							source: "claude",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("fs_write: src/index.ts");
	});

	it("parses codex tool activity into the compact tool label format", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "codex",
						latestHookActivity: {
							activityText: "Calling Read: src/index.ts",
							toolName: null,
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "raw_response_item",
							notificationType: null,
							source: "codex",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Read: src/index.ts");
		expect(container.textContent).not.toContain("Calling Read");
	});

	it("does not show a stale bare tool name for non-tool review updates", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="review"
					sessionSummary={createSummary("awaiting_review", {
						agentId: "claude",
						latestHookActivity: {
							activityText: "Waiting for review",
							toolName: "fs_write",
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "stop",
							notificationType: null,
							source: "claude",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Waiting for review");
		expect(container.textContent).not.toContain("fs_write");
	});

	it("renders session activity as single-line truncated text on trash cards", async () => {
		const preview =
			"Reviewing the archived implementation details and collecting the final notes for the handoff before cleanup hidden tail";

		await act(async () => {
			root.render(
				<TooltipProvider>
					<BoardCard
						card={createCard()}
						index={0}
						columnId="trash"
						sessionSummary={createSummary("awaiting_review", {
							latestHookActivity: {
								activityText: null,
								toolName: null,
								toolInputSummary: null,
								finalMessage: preview,
								hookEventName: "assistant_delta",
								notificationType: null,
								source: "codex",
							},
						})}
					/>
				</TooltipProvider>,
			);
		});

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === label);

		// Session activity uses CSS truncation with no See more / Less buttons
		expect(findButton("See more")).toBeUndefined();
		expect(findButton("Less")).toBeUndefined();

		// The full text is in the DOM (CSS handles visual truncation)
		expect(container.textContent).toContain(preview);
	});

	it("renders session activity as single-line truncated text for running tasks", async () => {
		const preview =
			"Reviewing the archived implementation details and collecting the final notes for the handoff before cleanup hidden tail";

		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						latestHookActivity: {
							activityText: null,
							toolName: null,
							toolInputSummary: null,
							finalMessage: preview,
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "codex",
						},
					})}
				/>,
			);
		});

		const findButton = (label: string) =>
			Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === label);

		// Session activity uses CSS truncation with no See more / Less buttons
		expect(findButton("See more")).toBeUndefined();
		expect(findButton("Less")).toBeUndefined();

		// The full text is in the DOM (CSS handles visual truncation)
		expect(container.textContent).toContain(preview);
	});

	it("shows the latest assistant preview on active task cards", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						latestHookActivity: {
							activityText: "Reviewing the final diff",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "Reviewing the final diff",
							hookEventName: "assistant_delta",
							notificationType: null,
							source: "codex",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("Reviewing the final diff");
		expect(container.textContent).not.toContain("Thinking...");
	});

	it("shows normal agent messages without the agent prefix", async () => {
		await act(async () => {
			root.render(
				<BoardCard
					card={createCard()}
					index={0}
					columnId="in_progress"
					sessionSummary={createSummary("running", {
						agentId: "codex",
						latestHookActivity: {
							activityText: "Agent: checking the next file",
							toolName: null,
							toolInputSummary: null,
							finalMessage: null,
							hookEventName: "agent_message",
							notificationType: null,
							source: "codex",
						},
					})}
				/>,
			);
		});

		expect(container.textContent).toContain("checking the next file");
		expect(container.textContent).not.toContain("Agent:");
	});
});
