import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import type { RuntimeProjectsResponse, RuntimeWorkspaceStateResponse } from "../src/runtime/types";
import type { BoardCard, BoardColumnId, BoardData } from "../src/types";

const ONBOARDING_DIALOG_SHOWN_KEY = "kanban.onboarding.dialog.shown";
const WORKSPACE_CONFLICT_MESSAGE =
	"Workspace changed elsewhere. Your local tickets were preserved; retry the edit if needed.";

test.beforeEach(async ({ page }) => {
	await page.addInitScript((key) => window.localStorage.setItem(key, "true"), ONBOARDING_DIALOG_SHOWN_KEY);
});

async function createTask(page: Page) {
	await page.getByRole("button", { name: /New task/ }).click();
	await page.getByRole("menuitem").first().click();
}

function unwrapTrpcPayload<T>(value: unknown): T {
	const envelope = Array.isArray(value) ? value[0] : value;
	if (!envelope || typeof envelope !== "object" || !("result" in envelope)) {
		throw new Error("Unexpected tRPC response envelope.");
	}
	const result = (envelope as { result?: { data?: unknown } }).result;
	const data = result?.data;
	if (data && typeof data === "object" && "json" in data) {
		return (data as { json: T }).json;
	}
	return data as T;
}

async function requestTrpc<T>({
	request,
	procedure,
	type,
	workspaceId,
	payload,
}: {
	request: APIRequestContext;
	procedure: string;
	type: "query" | "mutation";
	workspaceId?: string;
	payload?: unknown;
}): Promise<T> {
	const headers = workspaceId ? { "x-kanban-workspace-id": workspaceId } : undefined;
	const response =
		type === "query"
			? await request.get(`/api/trpc/${procedure}`, { headers })
			: await request.post(`/api/trpc/${procedure}`, { headers, data: payload });
	if (!response.ok()) {
		throw new Error(`${procedure} failed with HTTP ${response.status()}: ${await response.text()}`);
	}
	return unwrapTrpcPayload<T>(await response.json());
}

function placeTask(board: BoardData, columnId: BoardColumnId, card: BoardCard): BoardData {
	return {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards: [
				...column.cards.filter((candidate) => candidate.id !== card.id),
				...(column.id === columnId ? [card] : []),
			],
		})),
	};
}

function findTask(board: BoardData, taskId: string): { columnId: BoardColumnId; card: BoardCard } | null {
	for (const column of board.columns) {
		const card = column.cards.find((candidate) => candidate.id === taskId);
		if (card) {
			return { columnId: column.id, card };
		}
	}
	return null;
}

test("renders kanban top bar and columns", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/Kanban/);
	await expect(page.getByText("All projects", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Manage projects" })).toBeVisible();
	await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
	await expect(page.getByText("In Review / Blocked", { exact: true })).toBeVisible();
	await expect(page.getByText("On Hold", { exact: true })).toBeVisible();
	await expect(page.getByText("Done", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /New task/ })).toBeVisible();
});

test("persists existing browser console output in the frontend log", async ({ page }, testInfo) => {
	const runtimeHome = testInfo.config.metadata.runtimeHome;
	if (typeof runtimeHome !== "string" || !runtimeHome) {
		throw new Error("The Playwright configuration did not provide its runtime home.");
	}
	const marker = `playwright frontend log ${Date.now()}`;
	const visibleConsoleMessage = new Promise<string>((resolveMessage) => {
		page.on("console", (message) => {
			if (message.text().includes(marker)) {
				resolveMessage(message.text());
			}
		});
	});

	await page.goto("/");
	const logResponse = page.waitForResponse((response) => response.url().endsWith("/api/logs/frontend"));
	await page.evaluate((message) => console.warn(message), marker);
	await expect(visibleConsoleMessage).resolves.toContain(marker);
	expect((await logResponse).status()).toBe(204);
	const frontendLogPath = join(runtimeHome, "logs", "frontend.log");
	await expect
		.poll(() => (existsSync(frontendLogPath) ? readFileSync(frontendLogPath, "utf8") : ""))
		.toContain(`[warn] ${marker}`);
});

test("creating a task opens its live agent terminal directly", async ({ page }) => {
	await page.goto("/");
	await createTask(page);
	await expect(page).toHaveURL(/\?task=/);
	await expect(page.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
	await expect(page.getByRole("button", { name: "Open VS Code", exact: true })).toHaveCount(1);
	await expect(
		page.getByRole("navigation", { name: "Task breadcrumb" }).getByText("Deep mode", { exact: true }),
	).toBeVisible();
});

test("creating a task does not open a prompt dialog", async ({ page }) => {
	await page.goto("/");
	await createTask(page);
	await expect(page.getByRole("dialog", { name: "Start a task" })).toHaveCount(0);
	await expect(page.getByRole("textbox", { name: "Terminal input" })).toBeVisible();
});

test("creates, resolves, and removes a task dependency without changing lifecycle columns", async ({
	page,
	request,
}) => {
	const projects = await requestTrpc<RuntimeProjectsResponse>({
		request,
		procedure: "projects.list",
		type: "query",
	});
	const workspaceId = projects.currentProjectId ?? projects.projects[0]?.id;
	if (!workspaceId) throw new Error("Expected an isolated workspace.");
	const initialState = await requestTrpc<RuntimeWorkspaceStateResponse>({
		request,
		procedure: "workspace.getState",
		type: "query",
		workspaceId,
	});
	const now = Date.now();
	const dependent: BoardCard = {
		id: `dependent-${now}`,
		title: "Ship dependency UX",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: now,
		updatedAt: now,
	};
	const prerequisite: BoardCard = {
		id: `prerequisite-${now}`,
		title: "Finish runtime support",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: now + 1,
		updatedAt: now + 1,
	};
	await requestTrpc<RuntimeWorkspaceStateResponse>({
		request,
		procedure: "workspace.saveState",
		type: "mutation",
		workspaceId,
		payload: {
			board: placeTask(placeTask(initialState.board, "in_progress", dependent), "review", prerequisite),
			sessions: initialState.sessions,
			expectedRevision: initialState.revision,
		},
	});

	await page.goto("/");
	await page.locator(`[data-task-id="${dependent.id}"]`).click();
	const dependencyPanel = page.getByRole("region", { name: "Task dependencies" });
	await dependencyPanel.getByRole("button", { name: "Add" }).click();
	await page.getByRole("button", { name: prerequisite.title, exact: true }).click();
	await expect(dependencyPanel).toContainText(prerequisite.title);
	await expect(dependencyPanel).toContainText("Blocking");
	await expect(page.locator(`[data-task-id="${dependent.id}"][data-selected="true"]`)).toContainText("1 blocker");
	await expect(
		page.locator(`[data-task-id="${dependent.id}"][data-column-id="in_progress"][data-selected="true"]`),
	).toBeVisible();

	await expect
		.poll(async () => {
			const state = await requestTrpc<RuntimeWorkspaceStateResponse>({
				request,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			return state.board.dependencies.length === 1 ? state : null;
		})
		.not.toBeNull();
	const latestState = await requestTrpc<RuntimeWorkspaceStateResponse>({
		request,
		procedure: "workspace.getState",
		type: "query",
		workspaceId,
	});
	await requestTrpc<RuntimeWorkspaceStateResponse>({
		request,
		procedure: "workspace.saveState",
		type: "mutation",
		workspaceId,
		payload: {
			board: placeTask(latestState.board, "trash", { ...prerequisite, updatedAt: Date.now() }),
			sessions: latestState.sessions,
			expectedRevision: latestState.revision,
		},
	});

	await expect(dependencyPanel).toContainText("Done");
	await expect(page.locator(`[data-task-id="${dependent.id}"][data-selected="true"]`)).toContainText(
		"Dependencies done",
	);
	await dependencyPanel.getByRole("button", { name: `Remove dependency ${prerequisite.title}` }).click();
	await expect(dependencyPanel).toContainText("None");
	await expect
		.poll(async () => {
			const state = await requestTrpc<RuntimeWorkspaceStateResponse>({
				request,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			return state.board.dependencies;
		})
		.toEqual([]);
});

test("moving a card to Done removes the stale worktree path", async ({ page, request }) => {
	const projects = await requestTrpc<RuntimeProjectsResponse>({
		request,
		procedure: "projects.list",
		type: "query",
	});
	const workspaceId = projects.currentProjectId ?? projects.projects[0]?.id;
	if (!workspaceId) {
		throw new Error("Expected the isolated runtime to expose its current workspace.");
	}
	const initialState = await requestTrpc<RuntimeWorkspaceStateResponse>({
		request,
		procedure: "workspace.getState",
		type: "query",
		workspaceId,
	});
	const testRunId = Date.now();
	const task: BoardCard = {
		id: `e2e-done-${testRunId}`,
		title: "Move without stale worktree path",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: testRunId,
		updatedAt: testRunId,
	};
	await requestTrpc<RuntimeWorkspaceStateResponse>({
		request,
		procedure: "workspace.saveState",
		type: "mutation",
		workspaceId,
		payload: {
			board: placeTask(initialState.board, "review", task),
			sessions: initialState.sessions,
			expectedRevision: initialState.revision,
		},
	});

	let releaseWorkspaceCleanup: (() => void) | null = null;
	const workspaceCleanupReleased = new Promise<void>((resolve) => {
		releaseWorkspaceCleanup = resolve;
	});
	await page.route("**/api/trpc/workspace.deleteWorktree**", async (route) => {
		await workspaceCleanupReleased;
		await route.continue();
	});

	await page.goto("/");
	const reviewCard = page.locator(`[data-task-id="${task.id}"][data-column-id="review"]`);
	await expect(reviewCard).toContainText(task.title);
	await reviewCard.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("Space");

	try {
		const doneCard = page.locator(`[data-task-id="${task.id}"][data-column-id="trash"]`);
		await expect(doneCard).toContainText(task.title);
		await expect(doneCard).not.toContainText(new RegExp(`worktrees/${task.id}/project`));
	} finally {
		releaseWorkspaceCleanup?.();
	}
});

test("settings button opens runtime settings dialog", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.getByRole("dialog").getByText("Settings", { exact: true })).toBeVisible();
});

test("preserves a local card move during a conflicting server move", async ({ page, request }) => {
	const projects = await requestTrpc<RuntimeProjectsResponse>({
		request,
		procedure: "projects.list",
		type: "query",
	});
	const workspaceId = projects.currentProjectId ?? projects.projects[0]?.id;
	if (!workspaceId) {
		throw new Error("Expected the isolated runtime to expose its current workspace.");
	}
	const initialState = await requestTrpc<RuntimeWorkspaceStateResponse>({
		request,
		procedure: "workspace.getState",
		type: "query",
		workspaceId,
	});
	const testRunId = Date.now();
	const localTask: BoardCard = {
		id: `e2e-local-${testRunId}`,
		title: "Locally moved task",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: testRunId,
		updatedAt: testRunId,
	};
	const lifecycleTask: BoardCard = {
		id: `e2e-lifecycle-${testRunId}`,
		title: "Agent lifecycle task",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: testRunId,
		updatedAt: testRunId,
	};
	const seededBoard = placeTask(placeTask(initialState.board, "review", localTask), "in_progress", lifecycleTask);
	const seededState = await requestTrpc<RuntimeWorkspaceStateResponse>({
		request,
		procedure: "workspace.saveState",
		type: "mutation",
		workspaceId,
		payload: {
			board: seededBoard,
			sessions: initialState.sessions,
			expectedRevision: initialState.revision,
		},
	});

	let releaseFirstBrowserSave: (() => void) | null = null;
	const firstBrowserSaveReleased = new Promise<void>((resolve) => {
		releaseFirstBrowserSave = resolve;
	});
	let markFirstBrowserSaveIntercepted: (() => void) | null = null;
	const firstBrowserSaveIntercepted = new Promise<void>((resolve) => {
		markFirstBrowserSaveIntercepted = resolve;
	});
	let browserSaveCount = 0;
	await page.route("**/api/trpc/workspace.saveState**", async (route) => {
		browserSaveCount += 1;
		if (browserSaveCount === 1) {
			markFirstBrowserSaveIntercepted?.();
			await firstBrowserSaveReleased;
		}
		await route.continue();
	});

	try {
		await page.goto("/");
		const localCard = page.locator(`[data-task-id="${localTask.id}"]`);
		await expect(localCard).toContainText(localTask.title);
		await localCard.focus();
		await page.keyboard.press("Space");
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Space");
		await expect(page.locator(`[data-task-id="${localTask.id}"][data-column-id="on_hold"]`)).toBeVisible();
		await firstBrowserSaveIntercepted;

		const remoteLocalTask = { ...localTask, updatedAt: localTask.updatedAt + 1_000 };
		const remoteLifecycleTask = { ...lifecycleTask, updatedAt: lifecycleTask.updatedAt + 1_000 };
		await requestTrpc<RuntimeWorkspaceStateResponse>({
			request,
			procedure: "workspace.saveState",
			type: "mutation",
			workspaceId,
			payload: {
				board: placeTask(
					placeTask(seededState.board, "in_progress", remoteLocalTask),
					"review",
					remoteLifecycleTask,
				),
				sessions: seededState.sessions,
				expectedRevision: seededState.revision,
			},
		});

		releaseFirstBrowserSave?.();
		await expect(page.locator(`[data-task-id="${localTask.id}"][data-column-id="on_hold"]`)).toContainText(
			localTask.title,
		);
		await expect(page.locator(`[data-task-id="${lifecycleTask.id}"][data-column-id="review"]`)).toContainText(
			lifecycleTask.title,
		);

		await expect.poll(async () => browserSaveCount).toBe(2);
		await expect
			.poll(async () => {
				const state = await requestTrpc<RuntimeWorkspaceStateResponse>({
					request,
					procedure: "workspace.getState",
					type: "query",
					workspaceId,
				});
				const persistedLocalTask = findTask(state.board, localTask.id);
				const persistedLifecycleTask = findTask(state.board, lifecycleTask.id);
				return {
					localColumnId: persistedLocalTask?.columnId ?? null,
					lifecycleColumnId: persistedLifecycleTask?.columnId ?? null,
				};
			})
			.toEqual({ localColumnId: "on_hold", lifecycleColumnId: "review" });
		await expect(page.getByText(WORKSPACE_CONFLICT_MESSAGE, { exact: true })).toHaveCount(0);
	} finally {
		releaseFirstBrowserSave?.();
	}
});
