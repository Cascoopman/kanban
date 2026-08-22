import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import { type CreatedTask, useTaskEditor } from "@/hooks/use-task-editor";
import type { BoardData } from "@/types";

type EditorResult = ReturnType<typeof useTaskEditor>;

interface HookSnapshot extends EditorResult {
	board: BoardData;
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected a hook snapshot.");
	}
	return snapshot;
}

function Harness({ onSnapshot }: { onSnapshot: (snapshot: HookSnapshot) => void }): null {
	const [board, setBoard] = useState(createInitialBoardData);
	const editor = useTaskEditor({
		board,
		setBoard,
		defaultTaskBranchRef: "main",
		selectedAgentId: "codex",
	});

	useEffect(() => {
		onSnapshot({ ...editor, board });
	}, [board, editor, onSnapshot]);

	return null;
}

describe("useTaskEditor", () => {
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

	it("creates an in-progress placeholder task immediately", async () => {
		let snapshot: HookSnapshot | null = null;
		const onSnapshot = (next: HookSnapshot) => {
			snapshot = next;
		};
		await act(async () => root.render(<Harness onSnapshot={onSnapshot} />));

		const createdTask = { current: null as CreatedTask | null };
		act(() => {
			createdTask.current = requireSnapshot(snapshot).handleCreateTask();
		});

		const createdCard = requireSnapshot(snapshot).board.columns.find((column) => column.id === "in_progress")
			?.cards[0];
		expect(createdTask.current?.taskId).toBe(createdCard?.id);
		expect(createdCard).toMatchObject({
			title: "New task",
			agentId: "codex",
			baseRef: "main",
		});
	});

	it("does not create a task until a base ref is available", async () => {
		function NoBaseRefHarness({ onSnapshot }: { onSnapshot: (snapshot: HookSnapshot) => void }): null {
			const [board, setBoard] = useState(createInitialBoardData);
			const editor = useTaskEditor({
				board,
				setBoard,
				defaultTaskBranchRef: "",
				selectedAgentId: "codex",
			});
			useEffect(() => onSnapshot({ ...editor, board }), [board, editor, onSnapshot]);
			return null;
		}

		let snapshot: HookSnapshot | null = null;
		await act(async () =>
			root.render(
				<NoBaseRefHarness
					onSnapshot={(next) => {
						snapshot = next;
					}}
				/>,
			),
		);

		expect(requireSnapshot(snapshot).handleCreateTask()).toBeNull();
		expect(requireSnapshot(snapshot).board.columns.every((column) => column.cards.length === 0)).toBe(true);
	});
});
