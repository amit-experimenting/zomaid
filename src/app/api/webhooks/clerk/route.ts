import { Webhook } from "svix";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import type { WebhookEvent } from "@clerk/nextjs/server";

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) return new Response("misconfigured", { status: 500 });

  const h = await headers();
  const svixId = h.get("svix-id");
  const svixTimestamp = h.get("svix-timestamp");
  const svixSignature = h.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("missing signature headers", { status: 400 });
  }

  const body = await req.text();
  let evt: WebhookEvent;
  try {
    evt = new Webhook(secret).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  const supabase = createServiceClient();

  if (evt.type === "user.created" || evt.type === "user.updated") {
    const u = evt.data;
    const email =
      u.email_addresses.find((e) => e.id === u.primary_email_address_id)
        ?.email_address ??
      u.email_addresses[0]?.email_address ??
      "";
    const display = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();

    const { error } = await supabase.from("profiles").upsert(
      {
        clerk_user_id: u.id,
        email,
        display_name: display || email.split("@")[0] || "User",
      },
      { onConflict: "clerk_user_id" },
    );
    if (error) return new Response(error.message, { status: 500 });
  }

  if (evt.type === "user.deleted" && evt.data.id) {
    // Hard-delete the profile; cascading membership cleanup is out of scope here.
    const { error } = await supabase
      .from("profiles")
      .delete()
      .eq("clerk_user_id", evt.data.id);
    if (error) return new Response(error.message, { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
