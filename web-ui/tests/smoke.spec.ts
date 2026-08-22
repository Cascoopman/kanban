import { expect, type Page, test } from "@playwright/test";

async function createTask(page: Page, title: string) {
	await page.getByRole("button", { name: /New task/ }).click();
	await page.getByRole("menuitem").first().click();
	await page.getByPlaceholder("What are you working on?").fill(title);
	await page.getByRole("button", { name: /Create and open terminal/ }).click();
}

test("renders kanban top bar and columns", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/Kanban/);
	await expect(page.getByText("All projects", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Manage projects" })).toBeVisible();
	await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
	await expect(page.getByText("Review", { exact: true })).toBeVisible();
	await expect(page.getByText("Trash", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /New task/ })).toBeVisible();
});

test("creating a task opens it without a description editor", async ({ page }) => {
	await page.goto("/");
	const taskTitle = `smoke-${Date.now()}`;
	await createTask(page, taskTitle);
	await expect(page.locator("[data-task-id]").filter({ hasText: taskTitle }).first()).toBeVisible();
	await expect(page.getByPlaceholder("Describe the task")).toHaveCount(0);
});

test("escape key closes the create task dialog", async ({ page }) => {
	await page.goto("/");
	const taskTitle = `escape-${Date.now()}`;
	await page.getByRole("button", { name: /New task/ }).click();
	await page.getByRole("menuitem").first().click();
	await page.getByPlaceholder("What are you working on?").fill(taskTitle);
	await page.keyboard.press("Escape");
	await expect(page.getByPlaceholder("What are you working on?")).toHaveCount(0);
	await expect(page.locator("[data-task-id]").filter({ hasText: taskTitle })).toHaveCount(0);
});

test("settings button opens runtime settings dialog", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("open-settings-button").click();
	await expect(page.getByRole("dialog").getByText("Settings", { exact: true })).toBeVisible();
});
