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
    // Test path: direct SQL with a regular client.
    // The profiles trigger blocks is_admin changes for non-admins; bypass it with
    // session_replication_role so the boot-task SQL runs without a JWT in scope.
    await opts.pgClient.query("SET LOCAL session_replication_role = replica");
    await opts.pgClient.query(
      `update profiles set is_admin = (clerk_user_id = any($1))`,
      [ids],
    );
    await opts.pgClient.query("SET LOCAL session_replication_role = origin");
    return;
  }

  const svc = createServiceClient();
  const flag = await svc
    .from("profiles")
    .update({ is_admin: true })
    .in("clerk_user_id", ids.length ? ids : ["__none__"]);
  if (flag.error) throw new Error(flag.error.message);
  const unflag = await svc
    .from("profiles")
    .update({ is_admin: false })
    .not("clerk_user_id", "in", `(${ids.length ? ids.map((id) => `"${id}"`).join(",") : '""'})`);
  if (unflag.error) throw new Error(unflag.error.message);
}

export function readAdminEnv(): string[] {
  const raw = process.env.ZOMAID_ADMIN_CLERK_USER_IDS ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
