import "server-only";
import type { Client } from "pg";
import { createServiceClient } from "@/lib/supabase/server";

export async function syncAdminFlags(opts: {
  clerkUserIds: string[];
  /** Optional pg client for tests. If absent, uses Supabase service role. */
  pgClient?: Client;
}): Promise<void> {
  const ids = opts.clerkUserIds.map((s) => s.trim()).filter(Boolean);

  if (opts.pgClient) {
    // Test path: direct SQL with a regular client. With the corrected trigger
    // (migration 20260515_001), the is_admin block only fires for authenticated
    // end-users — direct postgres connections without a JWT skip it cleanly.
    await opts.pgClient.query(
      `update profiles set is_admin = (clerk_user_id = any($1))`,
      [ids],
    );
    return;
  }

  const svc = createServiceClient();
  // PostgREST requires a WHERE clause on updates; .neq against an impossible
  // sentinel matches every row without string-concatenating ids into a filter.
  const unflag = await svc
    .from("profiles")
    .update({ is_admin: false })
    .neq("clerk_user_id", "__never_admin_sentinel__");
  if (unflag.error) throw new Error(unflag.error.message);
  if (ids.length) {
    const flag = await svc
      .from("profiles")
      .update({ is_admin: true })
      .in("clerk_user_id", ids);
    if (flag.error) throw new Error(flag.error.message);
  }
}

export function readAdminEnv(): string[] {
  const raw = process.env.ZOMAID_ADMIN_CLERK_USER_IDS ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
