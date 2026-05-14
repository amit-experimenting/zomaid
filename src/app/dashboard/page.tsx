import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { MainNav } from "@/components/site/main-nav";
import { OwnerInviteMaidCard } from "@/components/site/owner-invite-maid-card";
import { InventoryPromptCard } from "@/components/site/inventory-prompt-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type OwnerCardProps =
  | { state: "empty" }
  | { state: "pending"; origin: string; code: string; token: string; inviteId: string }
  | { state: "joined"; maidName: string };

export default async function DashboardPage() {
  const ctx = await requireHousehold();
  const origin = await siteUrl();

  let pendingOwnerInviteToken: string | null = null;
  if (ctx.membership.role === "maid") {
    const supabase = await createClient();
    const r = await supabase
      .from("invites")
      .select("token")
      .eq("household_id", ctx.household.id)
      .eq("intended_role", "owner")
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (r.error) throw new Error(r.error.message);
    pendingOwnerInviteToken = r.data?.[0]?.token ?? null;
  }

  let ownerCard: OwnerCardProps | null = null;
  if (ctx.membership.role === "owner") {
    // Profile-join requires service client because profiles RLS only allows
    // self-read; mirrors the pattern in /household/settings.
    const svc = createServiceClient();
    const supabase = await createClient();
    const [maidRes, inviteRes] = await Promise.all([
      svc
        .from("household_memberships")
        .select("id, profile:profiles(display_name, email)")
        .eq("household_id", ctx.household.id)
        .eq("role", "maid")
        .eq("status", "active")
        .limit(1),
      supabase
        .from("invites")
        .select("id, code, token")
        .eq("household_id", ctx.household.id)
        .eq("intended_role", "maid")
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (maidRes.error) throw new Error(maidRes.error.message);
    if (inviteRes.error) throw new Error(inviteRes.error.message);

    // Database types are hand-curated and don't declare the household_memberships
    // → profiles FK embed; mirrors the cast in /household/settings.
    const maidRow = (maidRes.data?.[0] as unknown as
      | { id: string; profile: { display_name: string; email: string } | null }
      | undefined);
    if (maidRow?.profile) {
      ownerCard = { state: "joined", maidName: maidRow.profile.display_name || maidRow.profile.email };
    } else if (inviteRes.data?.length) {
      const inv = inviteRes.data[0];
      ownerCard = { state: "pending", origin, code: inv.code, token: inv.token, inviteId: inv.id };
    } else {
      ownerCard = { state: "empty" };
    }
  }

  let showInventoryCard = false;
  if (ctx.membership.role === "owner" || ctx.membership.role === "maid") {
    const supabase = await createClient();
    const { count } = await supabase
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("household_id", ctx.household.id);
    showInventoryCard =
      ctx.household.inventory_card_dismissed_at == null && (count ?? 0) < 5;
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="home" />
      <div className="px-4 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{ctx.household.name}</h1>
            <p className="text-sm text-muted-foreground">
              You are signed in as <strong>{ctx.profile.display_name}</strong> ({ctx.membership.role}).
            </p>
          </div>
          <Link href="/household/settings" className={cn(buttonVariants({ variant: "outline" }))}>
            Settings
          </Link>
        </div>

        {pendingOwnerInviteToken ? (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Share this link with your owner</CardTitle>
              <CardDescription>One-time link, expires in 7 days.</CardDescription>
            </CardHeader>
            <CardContent>
              <code className="block break-all rounded-md bg-muted p-3 text-xs">
                {`${origin}/join/${pendingOwnerInviteToken}`}
              </code>
            </CardContent>
          </Card>
        ) : null}

        {ownerCard ? <OwnerInviteMaidCard {...ownerCard} /> : null}

        {showInventoryCard && <InventoryPromptCard />}
      </div>
    </main>
  );
}
