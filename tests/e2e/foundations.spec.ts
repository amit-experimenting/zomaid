import { expect, test } from "@playwright/test";

test.describe("foundations — unauthenticated UI", () => {
  test("home renders sign-in CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Zomaid" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("/dashboard redirects unauthenticated users to /", async ({ page }) => {
    const resp = await page.goto("/dashboard");
    expect(resp?.url()).toMatch(/\/$/);
  });

  test("/onboarding redirects unauthenticated users to /", async ({ page }) => {
    const resp = await page.goto("/onboarding");
    expect(resp?.url()).toMatch(/\/$/);
  });
});
