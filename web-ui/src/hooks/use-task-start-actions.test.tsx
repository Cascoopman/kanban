import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreatedTask } from "@/hooks/use-task-editor";
import { useTaskStartActions } from "@/hooks/use-task-start-actions";
import type { BoardData, TaskImage } from "@/types";

type StartActions = ReturnType<typeof useTaskStartActions>;

function Harness({
	board,
	handleCreateTask,
	handleStartTask,
	setSelectedTaskId,
	onSnapshot,
}: {
	board: BoardData;
	handleCreateTask: () => CreatedTask | null;
	handleStartTask: Parameters<typeof useTaskStartActions>[0]["handleStartTask"];
	setSelectedTaskId: Parameters<typeof useTaskStartActions>[0]["setSelectedTaskId"];
	onSnapshot: (actions: StartActions) => void;
}): null {
	const actions = useTaskStartActions({ board, handleCreateTask, handleStartTask, setSelectedTaskId });
	useEffect(() => onSnapshot(actions), [actions, onSnapshot]);
	return null;
}

describe("useTaskStartActions", () => {
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

	it("starts a newly created in-progress task with its initial prompt and images", async () => {
		const image: TaskImage = {
			id: "image-1",
			data: "aGVsbG8=",
			mimeType: "image/png",
			name: "mock.png",
		};
		const createdTask: CreatedTask = {
			taskId: "task-1",
			prompt: "Implement the feature",
			images: [image],
		};
		const board: BoardData = {
			columns: [
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: createdTask.taskId,
							title: "Implement the feature",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "review", title: "Review", cards: [] },
				{ id: "on_hold", title: "On Hold", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
		};
		const handleStartTask = vi.fn();
		const setSelectedTaskId = vi.fn();
		let snapshot!: StartActions;
		const onSnapshot = (actions: StartActions) => {
			snapshot = actions;
		};

		await act(async () => {
			root.render(
				<Harness
					board={board}
					handleCreateTask={() => createdTask}
					handleStartTask={handleStartTask}
					setSelectedTaskId={setSelectedTaskId}
					onSnapshot={onSnapshot}
				/>,
			);
		});
		await act(async () => {
			expect(snapshot.handleCreateStartAndOpenTask()).toBe(createdTask.taskId);
		});

		expect(setSelectedTaskId).toHaveBeenCalledWith(createdTask.taskId);
		expect(handleStartTask).toHaveBeenCalledWith(createdTask.taskId, {
			initialPrompt: createdTask.prompt,
			images: createdTask.images,
		});
	});
});
