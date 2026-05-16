import { requireHousehold } from "@/lib/auth/require";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { MainNav } from "@/components/site/main-nav";
import { OwnerInviteMaidCard } from "@/components/site/owner-invite-maid-card";
import { InventoryPromptCard } from "@/components/site/inventory-prompt-card";
import { DayView, type MealSlotRow } from "@/components/dashboard/day-view";
import type { OccurrenceRowItem } from "@/components/tasks/occurrence-row";
import type { Recipe } from "@/components/plan/recipe-picker";
import type { Warning } from "@/components/plan/slot-warning-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TZ = "Asia/Singapore";
const ALL_SLOTS: MealSlotRow["slot"][] = ["breakfast", "lunch", "snacks", "dinner"];
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

/** Validate a `?date=` query param. Invalid → returns today's SG date. */
function resolveSelectedYmd(raw: string | undefined, todayYmd: string): string {
  if (!raw || !YMD_RE.test(raw)) return todayYmd;
  // Round-trip via sgYmd to catch rolls (e.g. 2026-13-40).
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
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const ctx = await requireHousehold();
  const origin = await siteUrl();
  const sp = await searchParams;

  // --- onboarding cards (unchanged) ----------------------------------------

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

  // --- Day view fetch ------------------------------------------------------

  const supabase = await createClient();
  const now = new Date();
  const todayYmd = sgYmd(now);
  const yesterdayYmd = sgYmd(addDays(now, -1));
  const selectedYmd = resolveSelectedYmd(sp?.date, todayYmd);
  const isToday = selectedYmd === todayYmd;

  // Permission flags — mirror /tasks/page.tsx and /plan/[date]/page.tsx.
  const isOwnerOrMaid =
    ctx.membership.role === "owner" || ctx.membership.role === "maid";
  const canAddTasks = isOwnerOrMaid || ctx.membership.role === "family_member";
  const taskActionsEnabled = isOwnerOrMaid;
  // can_modify_meal_plan() in the DB: not (family_member ∧ view_only).
  const mealPlanReadOnly =
    ctx.membership.role === "family_member" && ctx.membership.privilege === "view_only";

  // Materialise occurrences up to the selected date (idempotent).
  const horizonDate = addDays(new Date(`${selectedYmd}T12:00:00+08:00`), 1);
  await supabase.rpc("tasks_generate_occurrences", {
    p_horizon_date: sgYmd(horizonDate),
  });

  // Autofill meal slots when viewing today/future and caller can write. Cheap
  // when slots are already filled (RPC is idempotent).
  if (!mealPlanReadOnly && selectedYmd >= todayYmd) {
    const { error: autofillError } = await supabase.rpc("mealplan_autofill_date", {
      p_date: selectedYmd,
    });
    if (autofillError) {
      // Non-fatal: log and continue rendering whatever rows do exist.
      console.error("mealplan_autofill_date failed:", autofillError.message);
    }
  }

  // Window for task_occurrences: when viewing today, pull from the epoch so
  // overdue surfaces; otherwise just the target day. Same shape as
  // /tasks/[date]/page.tsx.
  const targetStart = new Date(`${selectedYmd}T00:00:00+08:00`);
  const targetEnd = new Date(`${selectedYmd}T00:00:00+08:00`);
  targetEnd.setDate(targetEnd.getDate() + 1);
  const leftEdge = isToday ? new Date("1970-01-01T00:00:00Z") : targetStart;

  const [
    { data: occRows },
    { data: rawMealRows },
    { data: mealTimes },
    { count: rosterCount },
    { data: effectiveRecipes },
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
      .select("slot, recipe_id, set_by_profile_id, people_eating, deduction_warnings, recipes(name, photo_path, household_id)")
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
    supabase.rpc("effective_recipes", { p_household: ctx.household.id }),
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
  // Supabase's generated types don't surface the task_occurrences→tasks
  // relation, so we cast via unknown — same pattern the original pages use.
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

  const overdue: OccurrenceRowItem[] = [];
  const onDay: OccurrenceRowItem[] = [];
  for (const r of all) {
    const item = toItem(r);
    const itemYmd = sgYmd(new Date(item.dueAt));
    if (itemYmd === selectedYmd) {
      onDay.push(item);
      continue;
    }
    // Only when viewing today: < yesterday pending items become Overdue.
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

  // Meal locks: 1 hour before each slot's configured start.
  const timeBySlot = Object.fromEntries((mealTimes ?? []).map((r) => [r.slot, r.meal_time]));
  const nowMs = Date.now();
  function isLocked(slot: string): boolean {
    const t = timeBySlot[slot];
    if (!t) return false;
    const [hh, mm] = (t as string).split(":").map(Number);
    const slotDt = new Date(`${selectedYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`);
    return nowMs >= slotDt.getTime() - 60 * 60 * 1000;
  }

  // Resolve photo URLs (signed for household, public for system). Sequential
  // awaits — same as /plan/[date]/page.tsx.
  const meals: MealSlotRow[] = [];
  for (const s of ALL_SLOTS) {
    const r = rawMealRows?.find((x) => x.slot === s);
    const recipeRaw = r?.recipes as unknown as
      | { name: string; photo_path: string | null; household_id: string | null }
      | { name: string; photo_path: string | null; household_id: string | null }[]
      | null;
    const recipe = Array.isArray(recipeRaw) ? recipeRaw[0] ?? null : recipeRaw;
    let photoUrl: string | null = null;
    if (recipe?.photo_path) {
      if (recipe.household_id === null) {
        photoUrl = supabase.storage
          .from("recipe-images-public")
          .getPublicUrl(recipe.photo_path).data.publicUrl;
      } else {
        const { data } = await supabase.storage
          .from("recipe-images-household")
          .createSignedUrl(recipe.photo_path, 3600);
        photoUrl = data?.signedUrl ?? null;
      }
    }
    meals.push({
      slot: s,
      recipeId: r?.recipe_id ?? null,
      recipeName: recipe?.name ?? null,
      photoUrl,
      setBySystem: r != null && r.set_by_profile_id === null,
      rowExists: r != null,
      peopleEating: r?.people_eating ?? null,
      locked: isLocked(s),
      deductionWarnings: (r?.deduction_warnings ?? []) as Warning[],
    });
  }

  const rosterSize = rosterCount ?? 1;
  const recipes: Recipe[] = (effectiveRecipes ?? []).map(
    (r: { id: string; name: string; slot: string }) => ({
      id: r.id,
      name: r.name,
      slot: r.slot,
      photo_url: null,
    }),
  );
  const recipeLibraryEmpty = recipes.length === 0;

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

        {ownerCard ? <OwnerInviteMaidCard {...ownerCard} /> : null}

        {showInventoryCard && <InventoryPromptCard />}

        <DayView
          selectedYmd={selectedYmd}
          todayYmd={todayYmd}
          overdue={overdue}
          tasks={onDay}
          meals={meals}
          recipes={recipes}
          rosterSize={rosterSize}
          taskActionsEnabled={taskActionsEnabled}
          canAddTasks={canAddTasks}
          mealPlanReadOnly={mealPlanReadOnly}
          recipeLibraryEmpty={recipeLibraryEmpty}
        />
      </div>
    </main>
  );
}
