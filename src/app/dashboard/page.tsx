import { requireHousehold } from "@/lib/auth/require";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { MainNav } from "@/components/site/main-nav";
import { OwnerInviteMaidCard } from "@/components/site/owner-invite-maid-card";
import { HouseholdModeCard } from "@/components/site/household-mode-card";
import { TaskSetupPromptCard } from "@/components/site/task-setup-prompt-card";
import { InventoryPromptCard } from "@/components/site/inventory-prompt-card";
import { DayView, type MealFeedItem } from "@/components/dashboard/day-view";
import type { OccurrenceRowItem } from "@/components/tasks/occurrence-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TZ = "Asia/Singapore";
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function sgYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function resolveSelectedYmd(raw: string | undefined, todayYmd: string): string {
  if (!raw || !YMD_RE.test(raw)) return todayYmd;
  const probe = new Date(`${raw}T12:00:00+08:00`);
  if (Number.isNaN(probe.getTime()) || sgYmd(probe) !== raw) return todayYmd;
  return raw;
}

type OwnerCardProps =
  | { state: "empty" }
  | { state: "pending"; origin: string; code: string; token: string; inviteId: string }
  | { state: "joined"; maidName: string };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requireHousehold();
  const origin = await siteUrl();
  const sp = await searchParams;

  // Gates introduced by 2026-05-16 task-setup design.
  const setupCompleted = ctx.household.task_setup_completed_at !== null;
  const showHouseholdModeCard =
    ctx.membership.role === "owner" && ctx.household.maid_mode === "unset";
  const showTaskSetupPromptCard =
    ctx.membership.role === "owner" &&
    ctx.household.maid_mode !== "unset" &&
    !setupCompleted;

  // --- onboarding cards (gated) ------------------------------------------

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
  if (ctx.membership.role === "owner" && ctx.household.maid_mode !== "unset") {
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

  // --- Day view fetch (gated on task_setup_completed_at) -----------------

  const supabase = await createClient();
  const now = new Date();
  const todayYmd = sgYmd(now);
  const yesterdayYmd = sgYmd(addDays(now, -1));
  const selectedYmd = resolveSelectedYmd(sp?.date, todayYmd);
  const isToday = selectedYmd === todayYmd;

  const isOwnerOrMaid =
    ctx.membership.role === "owner" || ctx.membership.role === "maid";
  const canAddTasks = isOwnerOrMaid || ctx.membership.role === "family_member";
  const taskActionsEnabled = isOwnerOrMaid;

  const overdue: OccurrenceRowItem[] = [];
  const onDay: OccurrenceRowItem[] = [];
  const meals: MealFeedItem[] = [];

  if (setupCompleted) {
    const horizonDate = addDays(new Date(`${selectedYmd}T12:00:00+08:00`), 1);
    await supabase.rpc("tasks_generate_occurrences", {
      p_horizon_date: sgYmd(horizonDate),
    });

    const targetStart = new Date(`${selectedYmd}T00:00:00+08:00`);
    const targetEnd = new Date(`${selectedYmd}T00:00:00+08:00`);
    targetEnd.setDate(targetEnd.getDate() + 1);
    const leftEdge = isToday ? new Date("1970-01-01T00:00:00Z") : targetStart;

    const [
      { data: occRows },
      { data: rawMealRows },
      { data: mealTimes },
      { count: rosterCount },
    ] = await Promise.all([
      supabase
        .from("task_occurrences")
        .select(
          "id, due_at, status, household_id, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))",
        )
        .eq("household_id", ctx.household.id)
        .gte("due_at", leftEdge.toISOString())
        .lt("due_at", targetEnd.toISOString())
        .order("due_at", { ascending: true }),
      supabase
        .from("meal_plans")
        .select(
          "slot, recipe_id, people_eating, recipes(name, kcal_per_serving, carbs_g_per_serving, fat_g_per_serving, protein_g_per_serving)",
        )
        .eq("household_id", ctx.household.id)
        .eq("plan_date", selectedYmd),
      supabase
        .from("household_meal_times")
        .select("slot,meal_time")
        .eq("household_id", ctx.household.id),
      supabase
        .from("household_memberships")
        .select("id", { count: "exact", head: true })
        .eq("household_id", ctx.household.id)
        .eq("status", "active"),
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
    const all = ((occRows ?? []) as unknown) as OccRow[];

    const toItem = (r: OccRow): OccurrenceRowItem => ({
      occurrenceId: r.id,
      taskId: r.tasks.id,
      title: r.tasks.title,
      dueAt: r.due_at,
      assigneeName: Array.isArray(r.tasks.profiles)
        ? (r.tasks.profiles[0]?.display_name ?? null)
        : (r.tasks.profiles?.display_name ?? null),
      status: r.status,
      isStandard: r.tasks.household_id === null,
    });

    for (const r of all) {
      const item = toItem(r);
      const itemYmd = sgYmd(new Date(item.dueAt));
      if (itemYmd === selectedYmd) {
        onDay.push(item);
        continue;
      }
      if (isToday && item.status === "pending" && itemYmd < yesterdayYmd) {
        overdue.push(item);
      }
    }

    const sortItems = (xs: OccurrenceRowItem[]) =>
      xs.sort((a, b) => {
        const da = new Date(a.dueAt).getTime();
        const db = new Date(b.dueAt).getTime();
        if (da !== db) return da - db;
        return a.title.localeCompare(b.title);
      });
    sortItems(overdue);
    sortItems(onDay);

    const timeBySlot = Object.fromEntries((mealTimes ?? []).map((r) => [r.slot, r.meal_time]));
    const rosterSize = rosterCount ?? 1;
    type Slot = MealFeedItem["slot"];
    for (const r of rawMealRows ?? []) {
      if (!r.recipe_id) continue;
      const t = timeBySlot[r.slot];
      if (!t) continue;
      type RecipeShape = {
        name: string;
        kcal_per_serving: number | string | null;
        carbs_g_per_serving: number | string | null;
        fat_g_per_serving: number | string | null;
        protein_g_per_serving: number | string | null;
      };
      const recipeRaw = r.recipes as unknown as RecipeShape | RecipeShape[] | null;
      const recipe = Array.isArray(recipeRaw) ? recipeRaw[0] ?? null : recipeRaw;
      if (!recipe?.name) continue;
      const [hh, mm] = (t as string).split(":").map(Number);
      const iso = `${selectedYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`;
      const num = (v: number | string | null) => (v == null ? null : Number(v));
      meals.push({
        slot: r.slot as Slot,
        recipeName: recipe.name,
        slotTimeIso: iso,
        kcalPerServing: num(recipe.kcal_per_serving),
        carbsGPerServing: num(recipe.carbs_g_per_serving),
        fatGPerServing: num(recipe.fat_g_per_serving),
        proteinGPerServing: num(recipe.protein_g_per_serving),
        peopleEating: r.people_eating ?? rosterSize,
      });
    }
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="home" />
      <div className="px-4 py-6">
        {pendingOwnerInviteToken ? (
          <Card>
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

        {showHouseholdModeCard ? <HouseholdModeCard /> : null}
        {ownerCard ? <OwnerInviteMaidCard {...ownerCard} /> : null}
        {showTaskSetupPromptCard ? <TaskSetupPromptCard /> : null}

        {showInventoryCard && <InventoryPromptCard />}

        <DayView
          selectedYmd={selectedYmd}
          todayYmd={todayYmd}
          overdue={overdue}
          tasks={onDay}
          meals={meals}
          taskActionsEnabled={taskActionsEnabled}
          canAddTasks={canAddTasks}
        />
      </div>
    </main>
  );
}
