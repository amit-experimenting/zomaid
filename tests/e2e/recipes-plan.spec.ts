import { test, expect } from "@playwright/test";

test.describe("slice 2a smoke (unauthenticated)", () => {
  test("/recipes is gated", async ({ page }) => {
    await page.goto("/recipes");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/recipes/<id> is also gated unauthenticated", async ({ page }) => {
    await page.goto("/recipes/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/dashboard shows the Recipes card with an active button when authenticated (manual)", async () => {
    test.skip(true, "Authenticated smoke requires Clerk test mode setup — covered in manual checklist.");
  });
});
