import { test, expect } from "@playwright/test";

test.describe("slice 3 auto-allocation smoke (unauthenticated)", () => {
  test("/plan/<today> redirects unauthenticated users to /", async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    await page.goto(`/plan/${today}`);
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/plan/<tomorrow> also redirects unauthenticated", async ({ page }) => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.goto(`/plan/${tomorrow}`);
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});
