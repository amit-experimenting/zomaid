import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWebPush } from "@/lib/push/webpush";

// Vercel Cron calls this every 5 minutes. Auth via Authorization: Bearer $CRON_SECRET.

const BATCH_LIMIT = 200;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET unset" }, { status: 500 });
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // 1. Fetch due+unnotified pending occurrences (with task -> household join).
  const { data: occurrences, error: occErr } = await supabase
    .from("task_occurrences")
    .select("id, due_at, task_id, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))")
    .eq("status", "pending")
    .is("notified_at", null)
    .lte("due_at", new Date().toISOString())
    .limit(BATCH_LIMIT);
  if (occErr) {
    return NextResponse.json({ error: occErr.message }, { status: 500 });
  }
  if (!occurrences || occurrences.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;
  let errors = 0;

  for (const occ of (occurrences as unknown) as Array<{
    id: string;
    due_at: string;
    task_id: string;
    tasks: { id: string; title: string; household_id: string; assigned_to_profile_id: string | null; profiles: { display_name: string } | null };
  }>) {
    const task = occ.tasks;
    const householdId = task.household_id;
    const assignedName = task.profiles?.display_name ?? null;

    // 2. Find owner+maid profile IDs for this household.
    const { data: members } = await supabase
      .from("household_memberships")
      .select("profile_id")
      .eq("household_id", householdId)
      .eq("status", "active")
      .in("role", ["owner", "maid"]);
    const profileIds = (members ?? []).map((m) => m.profile_id);
    if (profileIds.length === 0) continue;

    // 3. Find active push subscriptions for those profiles.
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
      .in("profile_id", profileIds)
      .is("revoked_at", null);
    if (!subs || subs.length === 0) {
      // Nothing to notify; mark notified so we don't keep retrying.
      await supabase.from("task_occurrences").update({ notified_at: new Date().toISOString() }).eq("id", occ.id);
      processed++;
      continue;
    }

    const payload = {
      title: task.title,
      body: assignedName ? `Due now — for ${assignedName}` : "Due now",
      data: { taskId: task.id, occurrenceId: occ.id },
    };

    let anySent = false;
    for (const sub of subs) {
      const result = await sendWebPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
        payload,
      );
      if (result.ok) {
        anySent = true;
        await supabase
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", sub.id);
      } else if (result.gone) {
        await supabase
          .from("push_subscriptions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", sub.id);
      } else {
        errors++;
      }
    }

    // Mark the occurrence notified regardless of per-sub failures: at least one
    // delivery was attempted. Even all-failed: we don't want to retry forever.
    await supabase
      .from("task_occurrences")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", occ.id);
    processed++;
    void anySent; // surfaced via processed count
  }

  return NextResponse.json({ processed, errors });
}
