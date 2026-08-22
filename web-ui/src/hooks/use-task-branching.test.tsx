import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import { useTaskBranching } from "@/hooks/use-task-branching";
import { addTaskToColumnWithResult } from "@/state/board-state";
import type { BoardData } from "@/types";

const branchTaskWorkspaceMock = vi.hoisted(() => vi.fn());
const showAppToastMock = vi.hoisted(() => vi.fn());
const notifyErrorMock = vi.hoisted(() => vi.fn());
const startTaskMock = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		workspace: {
			branchTaskWorkspace: { mutate: branchTaskWorkspaceMock },
		},
	}),
}));

vi.mock("@/components/app-toaster", () => ({
	showAppToast: showAppToastMock,
	notifyError: notifyErrorMock,
}));

type BranchingSnapshot = ReturnType<typeof useTaskBranching> & { board: BoardData };
let latestSnapshot: BranchingSnapshot | null = null;

function Harness({ initialBoard }: { initialBoard: BoardData }): React.ReactElement {
	const [board, setBoard] = useState(initialBoard);
	const branching = useTaskBranching({
		board,
		setBoard,
		currentProjectId: "workspace-1",
		onStartTask: startTaskMock,
	});
	useEffect(() => {
		latestSnapshot = { ...branching, board };
	}, [board, branching]);
	return <div />;
}

describe("useTaskBranching", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		latestSnapshot = null;
		branchTaskWorkspaceMock.mockReset();
		branchTaskWorkspaceMock.mockResolvedValue({
			ok: true,
			path: "/tmp/target-worktree",
			baseRef: "source-commit",
			baseCommit: "source-commit",
		});
		showAppToastMock.mockReset();
		notifyErrorMock.mockReset();
		startTaskMock.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("creates a backlog task linked to the source task", async () => {
		const source = addTaskToColumnWithResult(createInitialBoardData(), "review", {
			title: "Source task",
			startInPlanMode: true,
			agentId: "codex",
			baseRef: "main",
		});
		await act(async () => {
			root.render(<Harness initialBoard={source.board} />);
		});
		await act(async () => {
			latestSnapshot?.handleOpenBranchTask(source.task);
			latestSnapshot?.onTitleChange("Try the alternative design");
		});
		await act(async () => {
			await latestSnapshot?.handleCreateBranch();
		});

		expect(branchTaskWorkspaceMock).toHaveBeenCalledWith(
			expect.objectContaining({ sourceTaskId: source.task.id, baseRef: "main" }),
		);
		const branch = latestSnapshot?.board.columns.find((column) => column.id === "backlog")?.cards[0];
		expect(branch).toEqual(
			expect.objectContaining({
				title: "Try the alternative design",
				agentId: "codex",
				branchedFromTaskId: source.task.id,
			}),
		);
		expect(showAppToastMock).toHaveBeenCalledWith(
			expect.objectContaining({ intent: "success", message: "Task created." }),
		);
	});

	it("requires a title for the branched task", async () => {
		const source = addTaskToColumnWithResult(createInitialBoardData(), "review", {
			title: "Source task",
			startInPlanMode: false,
			baseRef: "main",
		});
		await act(async () => {
			root.render(<Harness initialBoard={source.board} />);
		});
		await act(async () => {
			latestSnapshot?.handleOpenBranchTask(source.task);
		});
		await act(async () => {
			await latestSnapshot?.handleCreateBranch();
		});

		const branch = latestSnapshot?.board.columns.find((column) => column.id === "backlog")?.cards[0];
		expect(branch).toBeUndefined();
		expect(branchTaskWorkspaceMock).not.toHaveBeenCalled();
	});

	it("resets the title when the branch dialog opens", async () => {
		const source = addTaskToColumnWithResult(createInitialBoardData(), "review", {
			title: "Source task",
			startInPlanMode: false,
			baseRef: "main",
		});
		await act(async () => {
			root.render(<Harness initialBoard={source.board} />);
		});
		await act(async () => {
			latestSnapshot?.handleOpenBranchTask(source.task);
		});
		expect(latestSnapshot?.title).toBe("");

		await act(async () => {
			latestSnapshot?.onTitleChange("Custom branch title");
		});
		expect(latestSnapshot?.title).toBe("Custom branch title");
	});

	it("starts the branched task after adding it to the backlog", async () => {
		const source = addTaskToColumnWithResult(createInitialBoardData(), "in_progress", {
			title: "Source task",
			startInPlanMode: false,
			agentId: "codex",
			baseRef: "main",
		});
		await act(async () => {
			root.render(<Harness initialBoard={source.board} />);
		});
		await act(async () => {
			latestSnapshot?.handleOpenBranchTask(source.task);
			latestSnapshot?.onTitleChange("Continue in another direction");
		});
		await act(async () => {
			await latestSnapshot?.handleCreateBranch({ start: true });
		});

		const branch = latestSnapshot?.board.columns.find((column) => column.id === "backlog")?.cards[0];
		expect(branch).toBeDefined();
		expect(startTaskMock).toHaveBeenCalledWith(branch?.id);
	});
});
