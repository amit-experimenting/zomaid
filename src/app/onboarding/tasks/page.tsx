// src/app/onboarding/tasks/page.tsx
import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/server";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { IconButton } from "@/components/ui/icon-button";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { deriveMatchingTags } from "@/lib/profile/matching-tags";
import { PickForm } from "./pick-form";
import type { HouseholdProfile } from "@/lib/profile/types";

export const dynamic = "force-dynamic";

export default async function OnboardingTasksPickPage() {
  const ctx = await requireHousehold();
  if (ctx.household.maid_mode === "unset") redirect("/dashboard");
  if (ctx.household.task_setup_completed_at !== null) redirect("/dashboard");

  const svc = createServiceClient();

  const profileRes = await svc
    .from("household_profiles")
    .select("age_groups, pets, work_hours, school_children, has_indoor_plants, has_balcony, has_ac, has_polishables")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (!profileRes.data) redirect("/onboarding/profile");

  const profile = profileRes.data as HouseholdProfile;
  const matchingTags = deriveMatchingTags(profile);

  const tasksRes = await svc
    .from("tasks")
    .select("id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time, relevance_tags")
    .is("household_id", null)
    .is("archived_at", null)
    .order("recurrence_frequency", { ascending: true })
    .order("recurrence_interval", { ascending: true })
    .order("recurrence_bymonthday", { ascending: true, nullsFirst: false })
    .order("due_time", { ascending: true, nullsFirst: false });
  if (tasksRes.error) throw new Error(tasksRes.error.message);

  const draftRes = await svc
    .from("task_setup_drafts")
    .select("picked_task_ids")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (draftRes.error && draftRes.error.code !== "PGRST116") {
    throw new Error(draftRes.error.message);
  }
  const initialPicks = draftRes.data?.picked_task_ids ?? null;

  return (
    <main>
      <TopAppBar
        title="Pick your tasks"
        subtitle="Step 2 of 2 — tap tasks you want; deselect what you don't"
        leading={
          <Link href="/onboarding/profile" aria-label="Back">
            <IconButton variant="ghost" aria-label="Back"><ChevronLeft /></IconButton>
          </Link>
        }
      />
      <PickForm
        tasks={tasksRes.data ?? []}
        matchingTags={matchingTags}
        profileSummary={renderProfileSummary(profile)}
        initialPicks={initialPicks}
      />
    </main>
  );
}

function renderProfileSummary(p: HouseholdProfile): string {
  const parts: string[] = [];
  if (p.age_groups.includes("infants")) parts.push("Infants");
  if (p.age_groups.includes("school_age")) parts.push("Young children");
  if (p.age_groups.includes("teens")) parts.push("Teens");
  if (p.age_groups.includes("seniors")) parts.push("Seniors");
  if (p.pets !== "none") parts.push(p.pets.charAt(0).toUpperCase() + p.pets.slice(1));
  if (p.has_indoor_plants) parts.push("Plants");
  if (p.has_balcony) parts.push("Balcony");
  if (p.has_ac) parts.push("A/C");
  if (p.has_polishables) parts.push("Polish");
  if (parts.length === 0) parts.push("Adults only");
  return parts.join(" · ");
}
