// Integration tests for the task-setup wizard server actions:
//   - saveTaskSetupPicks    (stage 1: persist picked standard-task ids)
//   - submitTaskSetup       (stage 2: materialise household-owned tasks +
//                            CAS-claim the household-level setup gate)
//   - resetTaskSetupForEmptyState
//                           (recovery path when the household ended up with
//                            zero tasks but the gate is still latched)
//
// Talks to real local Supabase over HTTP; only Clerk + Next stubs are mocked.
// Each test seeds via the service-role client and is responsible for its own
// cleanup. The wizard actions all redirect on success, so we use
// expectRedirect() around them.
//
// Cleanup order matters: task_setup_drafts → household_task_hides →
// household-scoped tasks → memberships → households → profiles. We *never*
// touch standard tasks (household_id IS NULL) — those come from the seed
// migration and other tests rely on them.

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClerk } from "../helpers/clerk";
import { expectRedirect, mockNextStubs } from "../helpers/next";
import {
  cleanupRows,
  createHousehold,
  createMembership,
  createProfile,
  serviceClient,
} from "../helpers/supabase-test-client";

type Ids = {
  profiles: string[];
  households: string[];
  memberships: string[];
  // Household-scoped tasks created by submitTaskSetup. We discover these via
  // a service-role select on household_id and push their ids here.
  tasks: string[];
};

function freshIds(): Ids {
  return { profiles: [], households: [], memberships: [], tasks: [] };
}

/**
 * Delete every household-scoped task for a household. Used in cleanup AFTER
 * task_setup_drafts and household_task_hides have been cleared. Standard
 * tasks (household_id IS NULL) are never touched.
 */
async function deleteHouseholdTasks(householdId: string): Promise<void> {
  const { error } = await serviceClient()
    .from("tasks")
    .delete()
    .eq("household_id", householdId);
  if (error) throw new Error(`deleteHouseholdTasks failed: ${error.message}`);
}

async function deleteSetupDraft(householdId: string): Promise<void> {
  const { error } = await serviceClient()
    .from("task_setup_drafts")
    .delete()
    .eq("household_id", householdId);
  if (error) throw new Error(`deleteSetupDraft failed: ${error.message}`);
}

async function deleteHides(householdId: string): Promise<void> {
  const { error } = await serviceClient()
    .from("household_task_hides")
    .delete()
    .eq("household_id", householdId);
  if (error) throw new Error(`deleteHides failed: ${error.message}`);
}

async function cleanupAll(ids: Ids): Promise<void> {
  // Children → parents. Clear wizard drafts + hides + household tasks per
  // household first, then memberships, households, profiles.
  for (const hid of ids.households) {
    await deleteSetupDraft(hid);
    await deleteHides(hid);
    await deleteHouseholdTasks(hid);
  }
  ids.tasks.splice(0); // owned by households we just cleared
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

/**
 * Seed an owner + household + active owner membership, with maid_mode set
 * (the wizard rejects maid_mode='unset'). Records cleanup ids.
 */
async function seedOwnerHouseholdReadyForWizard(
  ids: Ids,
  opts: { maidMode?: "invited" | "family_run" } = {},
) {
  const owner = await createProfile();
  ids.profiles.push(owner.id);
  const h = await createHousehold({ created_by_profile_id: owner.id });
  ids.households.push(h.id);
  // createHousehold defaults maid_mode='unset'; the wizard requires it to be
  // set first. Bump to 'family_run' (or whatever the test asks for) via the
  // service-role client.
  const mode = opts.maidMode ?? "family_run";
  const { error: upErr } = await serviceClient()
    .from("households")
    .update({ maid_mode: mode })
    .eq("id", h.id);
  if (upErr) throw new Error(`seed maid_mode failed: ${upErr.message}`);
  const m = await createMembership({
    household_id: h.id,
    profile_id: owner.id,
    role: "owner",
  });
  ids.memberships.push(m.id);
  return { owner, household: { ...h, maid_mode: mode }, membership: m };
}

/** Fetch two distinct standard-task ids from the seeded library. */
async function pickTwoStandardTaskIds(): Promise<[string, string]> {
  const { data, error } = await serviceClient()
    .from("tasks")
    .select("id")
    .is("household_id", null)
    .is("archived_at", null)
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data || data.length < 2) {
    throw new Error(
      "expected at least 2 seeded standard tasks; check migration 20260603_001",
    );
  }
  return [data[0].id, data[1].id];
}

describe("saveTaskSetupPicks (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner happy path: inserts a task_setup_drafts row with picked_task_ids and redirects to /onboarding/tasks/tune", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [id1, id2] = await pickTwoStandardTaskIds();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { saveTaskSetupPicks } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expectRedirect(
      saveTaskSetupPicks({ standardTaskIds: [id1, id2] }),
      "/onboarding/tasks/tune",
    );

    const { data: draft, error } = await serviceClient()
      .from("task_setup_drafts")
      .select("household_id, picked_task_ids, tuned_json")
      .eq("household_id", household.id)
      .single();
    expect(error).toBeNull();
    expect(draft?.household_id).toBe(household.id);
    expect(draft?.picked_task_ids).toEqual([id1, id2]);
    // tuned_json is only written by stage 2 (the tune step) — stays null here.
    expect(draft?.tuned_json).toBeNull();
  });

  it("re-calling upserts: a second save replaces picked_task_ids on the existing draft row", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [id1, id2] = await pickTwoStandardTaskIds();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { saveTaskSetupPicks } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expectRedirect(
      saveTaskSetupPicks({ standardTaskIds: [id1] }),
      "/onboarding/tasks/tune",
    );
    await expectRedirect(
      saveTaskSetupPicks({ standardTaskIds: [id1, id2] }),
      "/onboarding/tasks/tune",
    );

    // Exactly one draft row, with the latest picks.
    const { data: drafts } = await serviceClient()
      .from("task_setup_drafts")
      .select("household_id, picked_task_ids")
      .eq("household_id", household.id);
    expect(drafts).toHaveLength(1);
    expect(drafts![0].picked_task_ids).toEqual([id1, id2]);
  });

  it("maid can save picks", async () => {
    const { household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [id1, id2] = await pickTwoStandardTaskIds();

    const maid = await createProfile();
    ids.profiles.push(maid.id);
    const mMaid = await createMembership({
      household_id: household.id,
      profile_id: maid.id,
      role: "maid",
    });
    ids.memberships.push(mMaid.id);

    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();
    const { saveTaskSetupPicks } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expectRedirect(
      saveTaskSetupPicks({ standardTaskIds: [id1, id2] }),
      "/onboarding/tasks/tune",
    );

    // Draft was written with maid's picks.
    const { data: draft, error } = await serviceClient()
      .from("task_setup_drafts")
      .select("household_id, picked_task_ids, tuned_json")
      .eq("household_id", household.id)
      .single();
    expect(error).toBeNull();
    expect(draft?.household_id).toBe(household.id);
    expect(draft?.picked_task_ids).toEqual([id1, id2]);
    expect(draft?.tuned_json).toBeNull();
  });

  it("empty picks array is rejected by the zod schema (min(1))", async () => {
    // Documents the current schema: stage-1 save requires at least one pick.
    // If product wants to allow saving an empty selection mid-wizard, this
    // test will need to flip — kept as the pinned behaviour for now.
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { saveTaskSetupPicks } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expect(
      saveTaskSetupPicks({ standardTaskIds: [] }),
    ).rejects.toThrow();

    const { data: drafts } = await serviceClient()
      .from("task_setup_drafts")
      .select("household_id")
      .eq("household_id", household.id);
    expect(drafts ?? []).toHaveLength(0);
  });

  it("rejects unknown standard_task_ids (the action validates every id against the standard-tasks library)", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [realId] = await pickTwoStandardTaskIds();
    const fakeId = randomUUID();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { saveTaskSetupPicks } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expect(
      saveTaskSetupPicks({ standardTaskIds: [realId, fakeId] }),
    ).rejects.toThrow(/unknown standard task id/);

    const { data: drafts } = await serviceClient()
      .from("task_setup_drafts")
      .select("household_id")
      .eq("household_id", household.id);
    expect(drafts ?? []).toHaveLength(0);
  });

  it("rejects when household maid_mode is still 'unset' (caller must pick a mode first)", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    // Leave maid_mode='unset' (the createHousehold default).
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);

    const [id1] = await pickTwoStandardTaskIds();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { saveTaskSetupPicks } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expect(
      saveTaskSetupPicks({ standardTaskIds: [id1] }),
    ).rejects.toThrow(/set household mode first/);
  });

  it("rejects when task setup is already completed (gate latch)", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [id1] = await pickTwoStandardTaskIds();

    await serviceClient()
      .from("households")
      .update({ task_setup_completed_at: new Date().toISOString() })
      .eq("id", household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { saveTaskSetupPicks } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expect(
      saveTaskSetupPicks({ standardTaskIds: [id1] }),
    ).rejects.toThrow(/task setup already completed/);
  });
});

describe("submitTaskSetup (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner happy path: materialises one household-scoped task per entry, stamps task_setup_completed_at, deletes the draft, redirects to /dashboard", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [stdId1, stdId2] = await pickTwoStandardTaskIds();

    // Seed a draft so the wizard is "in progress" — submit doesn't actually
    // require a draft to exist (it reads from entries), but a realistic flow
    // always has one, and we want to assert that submit DELETES it.
    await serviceClient()
      .from("task_setup_drafts")
      .insert({
        household_id: household.id,
        picked_task_ids: [stdId1, stdId2],
      });

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { submitTaskSetup } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expectRedirect(
      submitTaskSetup({
        entries: [
          {
            standardTaskId: stdId1,
            frequency: "daily",
            interval: 1,
            dueTime: "09:00",
            assigneeProfileId: "anyone",
          },
          {
            standardTaskId: stdId2,
            frequency: "weekly",
            interval: 1,
            byweekday: [1, 4],
            dueTime: "10:30",
            assigneeProfileId: owner.id,
          },
        ],
      }),
      "/dashboard",
    );

    // 1) Household-scoped tasks exist, one per entry.
    const { data: tasks } = await serviceClient()
      .from("tasks")
      .select(
        "id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, due_time, assigned_to_profile_id, created_by_profile_id",
      )
      .eq("household_id", household.id)
      .order("recurrence_frequency", { ascending: true });
    expect(tasks).toHaveLength(2);
    // Save the materialised task ids so cleanupAll wipes them.
    for (const t of tasks!) ids.tasks.push(t.id);

    const daily = tasks!.find((t) => t.recurrence_frequency === "daily");
    const weekly = tasks!.find((t) => t.recurrence_frequency === "weekly");
    expect(daily?.recurrence_interval).toBe(1);
    expect(daily?.due_time).toBe("09:00:00");
    // "anyone" → null assignee.
    expect(daily?.assigned_to_profile_id).toBeNull();
    expect(daily?.created_by_profile_id).toBe(owner.id);

    expect(weekly?.recurrence_byweekday).toEqual([1, 4]);
    expect(weekly?.due_time).toBe("10:30:00");
    expect(weekly?.assigned_to_profile_id).toBe(owner.id);

    // 2) Gate latched.
    const { data: hAfter } = await serviceClient()
      .from("households")
      .select("task_setup_completed_at")
      .eq("id", household.id)
      .single();
    expect(hAfter?.task_setup_completed_at).not.toBeNull();

    // 3) Draft cleared.
    const { data: drafts } = await serviceClient()
      .from("task_setup_drafts")
      .select("household_id")
      .eq("household_id", household.id);
    expect(drafts ?? []).toHaveLength(0);

    // 4) All standard tasks are hidden for this household so they don't
    //    double-seed occurrences alongside the cloned household tasks.
    const { data: stdCount } = await serviceClient()
      .from("tasks")
      .select("id")
      .is("household_id", null)
      .is("archived_at", null);
    const { count: hideCount } = await serviceClient()
      .from("household_task_hides")
      .select("task_id", { count: "exact", head: true })
      .eq("household_id", household.id);
    expect(hideCount).toBe(stdCount!.length);
  });

  it("CAS-claim is idempotent: a second submit on a gate-latched household redirects to /dashboard without inserting another task", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [stdId] = await pickTwoStandardTaskIds();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { submitTaskSetup } = await import(
      "@/app/onboarding/tasks/actions"
    );

    const entries = [
      {
        standardTaskId: stdId,
        frequency: "daily" as const,
        interval: 1,
        dueTime: "09:00",
        assigneeProfileId: "anyone" as const,
      },
    ];

    // First submit: succeeds, redirects to /dashboard.
    await expectRedirect(submitTaskSetup({ entries }), "/dashboard");

    const { data: tasksAfterFirst } = await serviceClient()
      .from("tasks")
      .select("id")
      .eq("household_id", household.id);
    expect(tasksAfterFirst).toHaveLength(1);
    for (const t of tasksAfterFirst!) ids.tasks.push(t.id);

    // Second submit: the household.task_setup_completed_at is now non-null,
    // so the action's early-exit redirects to /dashboard WITHOUT writing
    // anything. (This is the "another tab already finished" branch.)
    await expectRedirect(submitTaskSetup({ entries }), "/dashboard");

    const { data: tasksAfterSecond } = await serviceClient()
      .from("tasks")
      .select("id")
      .eq("household_id", household.id);
    expect(tasksAfterSecond).toHaveLength(1);
  });

  it("maid can submit task setup", async () => {
    const { household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [stdId1, stdId2] = await pickTwoStandardTaskIds();

    const maid = await createProfile();
    ids.profiles.push(maid.id);
    const mMaid = await createMembership({
      household_id: household.id,
      profile_id: maid.id,
      role: "maid",
    });
    ids.memberships.push(mMaid.id);

    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();
    const { submitTaskSetup } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expectRedirect(
      submitTaskSetup({
        entries: [
          {
            standardTaskId: stdId1,
            frequency: "daily",
            interval: 1,
            dueTime: "09:00",
            assigneeProfileId: "anyone",
          },
          {
            standardTaskId: stdId2,
            frequency: "weekly",
            interval: 1,
            byweekday: [1, 4],
            dueTime: "10:30",
            assigneeProfileId: maid.id,
          },
        ],
      }),
      "/dashboard",
    );

    // Tasks materialised, gate latched.
    const { data: tasks } = await serviceClient()
      .from("tasks")
      .select("id")
      .eq("household_id", household.id);
    expect(tasks).toHaveLength(2);
    for (const t of tasks!) ids.tasks.push(t.id);

    const { data: h } = await serviceClient()
      .from("households")
      .select("task_setup_completed_at")
      .eq("id", household.id)
      .single();
    expect(h?.task_setup_completed_at).not.toBeNull();
  });

  it("rejects an unknown standard_task_id in entries", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);
    const fakeId = randomUUID();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { submitTaskSetup } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expect(
      submitTaskSetup({
        entries: [
          {
            standardTaskId: fakeId,
            frequency: "daily",
            interval: 1,
            dueTime: "09:00",
            assigneeProfileId: "anyone",
          },
        ],
      }),
    ).rejects.toThrow(/unknown standard task id/);

    // Gate untouched, no tasks.
    const { data: h } = await serviceClient()
      .from("households")
      .select("task_setup_completed_at")
      .eq("id", household.id)
      .single();
    expect(h?.task_setup_completed_at).toBeNull();
  });

  it("rejects when an assigneeProfileId is not an active member of the household", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);
    const [stdId] = await pickTwoStandardTaskIds();

    // A profile that exists but is NOT a member of this household.
    const stranger = await createProfile();
    ids.profiles.push(stranger.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { submitTaskSetup } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expect(
      submitTaskSetup({
        entries: [
          {
            standardTaskId: stdId,
            frequency: "daily",
            interval: 1,
            dueTime: "09:00",
            assigneeProfileId: stranger.id,
          },
        ],
      }),
    ).rejects.toThrow(/assignee is not an active member/);

    // No tasks, gate untouched.
    const { data: tasks } = await serviceClient()
      .from("tasks")
      .select("id")
      .eq("household_id", household.id);
    expect(tasks ?? []).toHaveLength(0);
    const { data: h } = await serviceClient()
      .from("households")
      .select("task_setup_completed_at")
      .eq("id", household.id)
      .single();
    expect(h?.task_setup_completed_at).toBeNull();
  });
});

describe("resetTaskSetupForEmptyState (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner happy path: with task_setup_completed_at set AND zero household tasks, resets the gate to null and redirects to /onboarding/tasks", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);

    // Latch the gate (simulating a previously-completed wizard whose tasks
    // were then wiped).
    await serviceClient()
      .from("households")
      .update({ task_setup_completed_at: new Date().toISOString() })
      .eq("id", household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { resetTaskSetupForEmptyState } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expectRedirect(
      resetTaskSetupForEmptyState(),
      "/onboarding/tasks",
    );

    const { data: h } = await serviceClient()
      .from("households")
      .select("task_setup_completed_at")
      .eq("id", household.id)
      .single();
    expect(h?.task_setup_completed_at).toBeNull();
  });

  it("guard: if the household has any household-scoped task, reset throws and the gate stays set", async () => {
    const { owner, household } = await seedOwnerHouseholdReadyForWizard(ids);

    const completedAt = new Date().toISOString();
    await serviceClient()
      .from("households")
      .update({ task_setup_completed_at: completedAt })
      .eq("id", household.id);

    // Seed a household-scoped task — the guard should refuse to reset.
    const taskId = randomUUID();
    const { error } = await serviceClient().from("tasks").insert({
      id: taskId,
      household_id: household.id,
      title: "Real task user kept",
      recurrence_frequency: "daily",
      recurrence_interval: 1,
      due_time: "09:00:00",
      created_by_profile_id: owner.id,
    });
    expect(error).toBeNull();
    ids.tasks.push(taskId);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { resetTaskSetupForEmptyState } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expect(resetTaskSetupForEmptyState()).rejects.toThrow(
      /household still has tasks/,
    );

    // Gate still latched, task still there.
    const { data: h } = await serviceClient()
      .from("households")
      .select("task_setup_completed_at")
      .eq("id", household.id)
      .single();
    expect(h?.task_setup_completed_at).not.toBeNull();
    const { data: stillThere } = await serviceClient()
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .single();
    expect(stillThere?.id).toBe(taskId);
  });

  it("short-circuits to /onboarding/tasks when task_setup_completed_at is already null (no-op recovery path)", async () => {
    const { owner } = await seedOwnerHouseholdReadyForWizard(ids);
    // Gate is null by default — don't latch it.

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { resetTaskSetupForEmptyState } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expectRedirect(
      resetTaskSetupForEmptyState(),
      "/onboarding/tasks",
    );
  });

  it("maid can reset task setup for empty state", async () => {
    const { household } = await seedOwnerHouseholdReadyForWizard(ids);

    // Latch the gate (simulating a previously-completed wizard whose tasks
    // were then wiped).
    await serviceClient()
      .from("households")
      .update({ task_setup_completed_at: new Date().toISOString() })
      .eq("id", household.id);

    const maid = await createProfile();
    ids.profiles.push(maid.id);
    const mMaid = await createMembership({
      household_id: household.id,
      profile_id: maid.id,
      role: "maid",
    });
    ids.memberships.push(mMaid.id);

    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();
    const { resetTaskSetupForEmptyState } = await import(
      "@/app/onboarding/tasks/actions"
    );

    await expectRedirect(
      resetTaskSetupForEmptyState(),
      "/onboarding/tasks",
    );

    // Gate reset to null.
    const { data: h } = await serviceClient()
      .from("households")
      .select("task_setup_completed_at")
      .eq("id", household.id)
      .single();
    expect(h?.task_setup_completed_at).toBeNull();
  });
});
