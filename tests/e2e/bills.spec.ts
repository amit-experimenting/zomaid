import { test, expect } from "@playwright/test";

test.describe("bills smoke (unauthenticated)", () => {
  // /bills (index) was deleted when the GitHub-Issues OCR pipeline was retired.
  // /bills/[id] is the only surviving route under /bills(.*) and is still
  // covered by the Clerk auth-gate matcher in src/proxy.ts.
  test("/bills/[id] redirects unauthenticated users to /", async ({ page }) => {
    await page.goto("/bills/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
});
