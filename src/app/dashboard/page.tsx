import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { MainNav } from "@/components/site/main-nav";
import { OwnerInviteMaidCard } from "@/components/site/owner-invite-maid-card";
import { InventoryPromptCard } from "@/components/site/inventory-prompt-card";
import { TodayView, type MealItem } from "@/components/dashboard/today-view";
import type { OccurrenceRowItem } from "@/components/tasks/occurrence-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TZ = "Asia/Singapore";

function sgYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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

  // Today's tasks + meal plan for the new "Today" section. Both queries are
  // cheap (single date) and run for every household member regardless of role
  // — family members see read-only views.
  const supabase = await createClient();
  const todayYmd = sgYmd(new Date());
  const dayStart = new Date(`${todayYmd}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(`${todayYmd}T00:00:00+08:00`);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const dayEndIso = dayEnd.toISOString();

  // Generate occurrences out to tomorrow (idempotent; cheap when nothing missing).
  await supabase.rpc("tasks_generate_occurrences", { p_horizon_date: todayYmd });

  const [{ data: occRows }, { data: planRows }] = await Promise.all([
    supabase
      .from("task_occurrences")
      .select(
        "id, due_at, status, household_id, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))",
      )
      .eq("household_id", ctx.household.id)
      .gte("due_at", dayStart)
      .lt("due_at", dayEndIso)
      .order("due_at", { ascending: true }),
    supabase
      .from("meal_plans")
      .select("slot, recipe:recipes(id, name)")
      .eq("household_id", ctx.household.id)
      .eq("plan_date", todayYmd),
  ]);

  type OccRow = {
    id: string;
    due_at: string;
    status: "pending" | "done" | "skipped";
    tasks: {
      id: string;
      title: string;
      household_id: string | null;
      profiles: { display_name: string } | { display_name: string }[] | null;
    };
  };
  const todayTasks: OccurrenceRowItem[] = ((occRows ?? []) as unknown as OccRow[]).map((r) => ({
    occurrenceId: r.id,
    taskId: r.tasks.id,
    title: r.tasks.title,
    dueAt: r.due_at,
    assigneeName: Array.isArray(r.tasks.profiles)
      ? (r.tasks.profiles[0]?.display_name ?? null)
      : (r.tasks.profiles?.display_name ?? null),
    status: r.status,
    isStandard: r.tasks.household_id === null,
  }));

  type PlanRow = {
    slot: "breakfast" | "lunch" | "snacks" | "dinner";
    recipe: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const todayMeals: MealItem[] = ((planRows ?? []) as unknown as PlanRow[]).map((r) => {
    const rec = Array.isArray(r.recipe) ? r.recipe[0] ?? null : r.recipe;
    return {
      slot: r.slot,
      recipeId: rec?.id ?? null,
      recipeName: rec?.name ?? null,
    };
  });

  const taskReadOnly = ctx.membership.role !== "owner" && ctx.membership.role !== "maid";

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

        <TodayView
          dateYmd={todayYmd}
          tasks={todayTasks}
          meals={todayMeals}
          readOnly={taskReadOnly}
        />
      </div>
    </main>
  );
}
