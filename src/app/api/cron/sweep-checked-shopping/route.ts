// Vercel cron — once a day at 00:05 SG (16:05 UTC), commits every
// "checked but not yet bought" shopping row to inventory and moves it to
// the bought history. See docs/specs/2026-05-16-shopping-checked-state-design.md.
//
// Auth via Authorization: Bearer $CRON_SECRET.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET unset" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  // shopping_sweep_checked iterates internally and calls
  // shopping_commit_to_inventory per row; one RPC call covers every
  // household. Returns the number of rows committed.
  const { data, error } = await svc.rpc("shopping_sweep_checked");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, committed: data ?? 0 });
}
