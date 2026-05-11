import { test, expect } from "@playwright/test";

test.describe("slice 5 smoke (unauthenticated)", () => {
  test("/tasks redirects unauthenticated users to /", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});
