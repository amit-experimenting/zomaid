import { test, expect } from "@playwright/test";

test.describe("slice 3 smoke (unauthenticated)", () => {
  test("/bills redirects unauthenticated users to /", async ({ page }) => {
    await page.goto("/bills");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});
