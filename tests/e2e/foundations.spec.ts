import { expect, test } from "@playwright/test";

test.describe("foundations — unauthenticated UI", () => {
  test("home renders sign-in CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Zomaid" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("/dashboard redirects unauthenticated users to /", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("http://localhost:3000/");
  });

  test("/onboarding redirects unauthenticated users to /", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});
