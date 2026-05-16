import "server-only";

import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Banner } from "@/components/ui/banner";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Slim "you have N bill scans waiting" banner shown above pages that
 * want to surface the bill-scan-retry queue (today: /inventory).
 *
 * MainNav cannot host this because some pages import MainNav from a
 * client component context; this is opt-in per server page instead.
 * Best-effort: any failure renders nothing.
 */
export async function PendingScansBanner() {
  let count = 0;
  try {
    const { userId } = await auth();
    if (!userId) return null;
    const svc = createServiceClient();
    const profile = await svc
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", userId)
      .maybeSingle();
    if (!profile.data) return null;
    const { count: n } = await svc
      .from("bill_scan_attempts")
      .select("id", { count: "exact", head: true })
      .eq("uploaded_by_profile_id", profile.data.id)
      .eq("status", "succeeded")
      .is("reviewed_at", null);
    count = n ?? 0;
  } catch {
    return null;
  }
  if (count === 0) return null;
  return (
    <Link href="/scans/pending" className="mx-4 my-2 block">
      <Banner
        tone="warning"
        action={<span className="font-semibold text-primary">Open the queue →</span>}
      >
        <span className="font-medium">{count}</span> bill scan
        {count === 1 ? "" : "s"} ready to review.
      </Banner>
    </Link>
  );
}
