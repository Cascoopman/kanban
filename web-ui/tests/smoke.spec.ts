import { expect, type Page, test } from "@playwright/test";

async function createTask(page: Page) {
	await page.getByRole("button", { name: /New task/ }).click();
	await page.getByRole("menuitem").first().click();
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

test("creating a task opens its live agent terminal directly", async ({ page }) => {
	await page.goto("/");
	await createTask(page);
	await expect(page).toHaveURL(/\?task=/);
	await expect(page.getByRole("textbox", { name: "Terminal input" })).toBeFocused();
	await expect(page.getByText("New task", { exact: true }).first()).toBeVisible();
});

test("creating a task does not open a prompt dialog", async ({ page }) => {
	await page.goto("/");
	await createTask(page);
	await expect(page.getByRole("dialog", { name: "Start a task" })).toHaveCount(0);
	await expect(page.getByRole("textbox", { name: "Terminal input" })).toBeVisible();
});

test("settings button opens runtime settings dialog", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("open-settings-button").click();
	await expect(page.getByRole("dialog").getByText("Settings", { exact: true })).toBeVisible();
});
