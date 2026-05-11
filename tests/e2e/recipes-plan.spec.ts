import { test, expect } from "@playwright/test";

test.describe("slice 2a smoke (unauthenticated)", () => {
  test("/plan redirects unauthenticated users to /", async ({ page }) => {
    await page.goto("/plan");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/recipes is also gated", async ({ page }) => {
    await page.goto("/recipes");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/dashboard shows the Recipes card with an active button when authenticated (manual)", async () => {
    test.skip(true, "Authenticated smoke requires Clerk test mode setup — covered in manual checklist.");
  });
});
