import { test, expect } from "@playwright/test";

test.describe("slice 2 inventory smoke (unauthenticated)", () => {
  test("/inventory redirects unauthenticated users to /", async ({ page }) => {
    await page.goto("/inventory");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/inventory/new is also gated", async ({ page }) => {
    await page.goto("/inventory/new");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/inventory/conversions is also gated", async ({ page }) => {
    await page.goto("/inventory/conversions");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/household/meal-times is also gated", async ({ page }) => {
    await page.goto("/household/meal-times");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});
