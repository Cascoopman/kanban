import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import { type CreatedTask, useTaskEditor } from "@/hooks/use-task-editor";
import type { BoardData, TaskImage } from "@/types";

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
		currentProjectId: "project",
		createTaskBranchOptions: [{ value: "main", label: "main" }],
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

	it("requires a prompt before creating a task", async () => {
		let snapshot: HookSnapshot | null = null;
		const onSnapshot = (next: HookSnapshot) => {
			snapshot = next;
		};
		await act(async () => root.render(<Harness onSnapshot={onSnapshot} />));

		act(() => requireSnapshot(snapshot).handleOpenCreateTask());
		const createdTask = { current: null as CreatedTask | null };
		act(() => {
			createdTask.current = requireSnapshot(snapshot).handleCreateTask();
		});

		expect(createdTask.current).toBeNull();
		expect(requireSnapshot(snapshot).isInlineTaskCreateOpen).toBe(true);
		expect(requireSnapshot(snapshot).board.columns.every((column) => column.cards.length === 0)).toBe(true);
	});

	it("creates an in-progress task with a derived title and returns its kickoff prompt", async () => {
		let snapshot: HookSnapshot | null = null;
		const onSnapshot = (next: HookSnapshot) => {
			snapshot = next;
		};
		await act(async () => root.render(<Harness onSnapshot={onSnapshot} />));
		await act(async () => {
			requireSnapshot(snapshot).handleOpenCreateTask();
			requireSnapshot(snapshot).setNewTaskPrompt("Implement prompt-first task creation. Keep it focused.");
		});

		const createdTask = { current: null as CreatedTask | null };
		await act(async () => {
			createdTask.current = requireSnapshot(snapshot).handleCreateTask();
		});

		const createdCard = requireSnapshot(snapshot).board.columns.find((column) => column.id === "in_progress")
			?.cards[0];
		expect(createdTask.current?.taskId).toBe(createdCard?.id);
		expect(createdTask.current?.prompt).toBe("Implement prompt-first task creation. Keep it focused.");
		expect(createdCard).toMatchObject({
			title: "Implement prompt-first task creation.",
			agentId: "codex",
			baseRef: "main",
		});
		expect(requireSnapshot(snapshot).isInlineTaskCreateOpen).toBe(false);
		expect(requireSnapshot(snapshot).newTaskPrompt).toBe("");
	});

	it("returns attached images for the initial agent turn", async () => {
		let snapshot: HookSnapshot | null = null;
		const onSnapshot = (next: HookSnapshot) => {
			snapshot = next;
		};
		const image: TaskImage = {
			id: "image-1",
			data: "aGVsbG8=",
			mimeType: "image/png",
			name: "mock.png",
		};
		await act(async () => root.render(<Harness onSnapshot={onSnapshot} />));
		await act(async () => {
			requireSnapshot(snapshot).handleOpenCreateTask();
			requireSnapshot(snapshot).setNewTaskPrompt("Inspect this screenshot");
			requireSnapshot(snapshot).setNewTaskImages([image]);
		});

		const createdTask = { current: null as CreatedTask | null };
		await act(async () => {
			createdTask.current = requireSnapshot(snapshot).handleCreateTask();
		});

		expect(createdTask.current?.images).toEqual([image]);
		expect(requireSnapshot(snapshot).newTaskImages).toEqual([]);
	});
});
