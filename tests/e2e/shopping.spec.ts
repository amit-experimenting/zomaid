import { test, expect } from "@playwright/test";

test.describe("slice 2b smoke (unauthenticated)", () => {
  test("/shopping redirects unauthenticated users to /", async ({ page }) => {
    await page.goto("/shopping");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});
