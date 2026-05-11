import { test } from "@playwright/test";

// Stub spec for the owner-side "Invite your maid" card on /dashboard.
// Follows the project's standing "skip tests" instruction (see HANDOFF.md);
// captures the three intended scenarios so the next test push picks them up.

test.describe.skip("dashboard — owner invite-maid card", () => {
  test("empty state: owner with no maid sees Generate invite button", async () => {
    // 1. Sign in as owner of a household with no active maid + no pending maid invite.
    // 2. Visit /dashboard.
    // 3. Expect 'Invite your maid' heading + 'Generate invite' button visible.
  });

  test("pending state: clicking Generate shows code + link + Copy/Share/Revoke", async () => {
    // 1. Sign in as owner with no pending invite.
    // 2. Click 'Generate invite'.
    // 3. Expect 'Share this with your maid' heading, a 6-digit code, the
    //    /join/<token> URL, plus 'Copy link' and 'Revoke' buttons.
    // 4. Click 'Revoke' → returns to empty state.
  });

  test("joined state: owner with active maid sees Maid: <name> card with Manage link", async () => {
    // 1. Seed a household with active owner + active maid memberships.
    // 2. Sign in as owner, visit /dashboard.
    // 3. Expect 'Maid: <display_name>' heading + 'Joined' badge + Manage link
    //    pointing to /household/settings.
  });
});
