// Integration tests for the createTask + updateTask server actions.
// These talk to a real local Supabase over HTTP — we mock only Clerk and the
// Next.js cache/navigation stubs. Each test seeds via the service-role client
// and is responsible for its own cleanup (tasks first, then memberships,
// households, profiles).

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClerk } from "../helpers/clerk";
import { mockNextStubs } from "../helpers/next";
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
  tasks: string[];
};

function freshIds(): Ids {
  return { profiles: [], households: [], memberships: [], tasks: [] };
}

async function cleanupAll(ids: Ids): Promise<void> {
  // task_occurrences cascade-delete with the parent task, so a tasks delete
  // is sufficient. Order: children → memberships → households → profiles.
  await cleanupRows("tasks", ids.tasks.splice(0));
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

/** Seed an owner + household + active owner membership. Records cleanup ids. */
async function seedOwnerHousehold(ids: Ids) {
  const owner = await createProfile();
  ids.profiles.push(owner.id);
  const h = await createHousehold({ created_by_profile_id: owner.id });
  ids.households.push(h.id);
  const m = await createMembership({
    household_id: h.id,
    profile_id: owner.id,
    role: "owner",
  });
  ids.memberships.push(m.id);
  return { owner, household: h, membership: m };
}

describe("createTask (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner can create a daily recurring task with expected fields", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createTask } = await import("@/app/tasks/actions");

    const result = await createTask({
      title: "Take out the trash",
      notes: "Use the green bin",
      assignedToProfileId: owner.id,
      recurrence: { frequency: "daily", interval: 1 },
      dueTime: "08:30",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    ids.tasks.push(result.data.taskId);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select(
        "household_id,title,notes,assigned_to_profile_id,recurrence_frequency,recurrence_interval,recurrence_byweekday,recurrence_bymonthday,due_time,created_by_profile_id",
      )
      .eq("id", result.data.taskId)
      .single();
    expect(row?.household_id).toBe(household.id);
    expect(row?.title).toBe("Take out the trash");
    expect(row?.notes).toBe("Use the green bin");
    expect(row?.assigned_to_profile_id).toBe(owner.id);
    expect(row?.recurrence_frequency).toBe("daily");
    expect(row?.recurrence_interval).toBe(1);
    expect(row?.recurrence_byweekday).toBeNull();
    expect(row?.recurrence_bymonthday).toBeNull();
    // PostgREST normalises HH:MM → HH:MM:SS.
    expect(row?.due_time).toBe("08:30:00");
    expect(row?.created_by_profile_id).toBe(owner.id);
  });

  it("owner can create a weekly task with byweekday", async () => {
    const { owner } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createTask } = await import("@/app/tasks/actions");

    const result = await createTask({
      title: "Water the plants",
      recurrence: { frequency: "weekly", interval: 1, byweekday: [1, 4] },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    ids.tasks.push(result.data.taskId);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("recurrence_frequency,recurrence_byweekday,recurrence_bymonthday")
      .eq("id", result.data.taskId)
      .single();
    expect(row?.recurrence_frequency).toBe("weekly");
    expect(row?.recurrence_byweekday).toEqual([1, 4]);
    expect(row?.recurrence_bymonthday).toBeNull();
  });

  it("owner can create a monthly task with bymonthday", async () => {
    const { owner } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createTask } = await import("@/app/tasks/actions");

    const result = await createTask({
      title: "Pay the rent",
      recurrence: { frequency: "monthly", interval: 1, bymonthday: 15 },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    ids.tasks.push(result.data.taskId);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("recurrence_frequency,recurrence_byweekday,recurrence_bymonthday")
      .eq("id", result.data.taskId)
      .single();
    expect(row?.recurrence_frequency).toBe("monthly");
    expect(row?.recurrence_byweekday).toBeNull();
    expect(row?.recurrence_bymonthday).toBe(15);
  });

  it("owner can create a one-off (single-day) task by capping the recurrence end on the start", async () => {
    // The schema requires a recurrence frequency; a "one-off" is modelled as a
    // daily recurrence whose starts_on == ends_on, which is the same pattern
    // the UI uses for single-occurrence reminders.
    const { owner } = await seedOwnerHousehold(ids);
    const date = new Date().toISOString().slice(0, 10);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createTask } = await import("@/app/tasks/actions");

    const result = await createTask({
      title: "Pick up parcel",
      recurrence: {
        frequency: "daily",
        interval: 1,
        startsOn: date,
        endsOn: date,
      },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    ids.tasks.push(result.data.taskId);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("recurrence_starts_on,recurrence_ends_on")
      .eq("id", result.data.taskId)
      .single();
    expect(row?.recurrence_starts_on).toBe(date);
    expect(row?.recurrence_ends_on).toBe(date);
  });

  it("family_member can create a task (post-2026-06-26 RLS broadening)", async () => {
    const { household } = await seedOwnerHousehold(ids);
    const fam = await createProfile();
    ids.profiles.push(fam.id);
    const mFam = await createMembership({
      household_id: household.id,
      profile_id: fam.id,
      role: "family_member",
    });
    ids.memberships.push(mFam.id);

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { createTask } = await import("@/app/tasks/actions");

    const result = await createTask({
      title: "Buy milk",
      recurrence: { frequency: "daily", interval: 1 },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    ids.tasks.push(result.data.taskId);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("created_by_profile_id")
      .eq("id", result.data.taskId)
      .single();
    expect(row?.created_by_profile_id).toBe(fam.id);
  });

  it("rejects weekly recurrence missing byweekday with TASK_INVALID", async () => {
    const { owner } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createTask } = await import("@/app/tasks/actions");

    const result = await createTask({
      title: "Bad weekly",
      // No byweekday — Zod superRefine should reject.
      recurrence: { frequency: "weekly", interval: 1 },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("TASK_INVALID");
  });

  it("rejects monthly recurrence missing bymonthday with TASK_INVALID", async () => {
    const { owner } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createTask } = await import("@/app/tasks/actions");

    const result = await createTask({
      title: "Bad monthly",
      recurrence: { frequency: "monthly", interval: 1 },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("TASK_INVALID");
  });

  it("user with no membership is redirected to /onboarding by requireHousehold", async () => {
    const orphan = await createProfile();
    ids.profiles.push(orphan.id);

    mockClerk({ clerkUserId: orphan.clerk_user_id });
    mockNextStubs();
    const { createTask } = await import("@/app/tasks/actions");

    // requireHousehold() calls next/navigation redirect(), which our stub
    // throws as a NEXT_REDIRECT error. The action propagates it.
    await expect(
      createTask({
        title: "x",
        recurrence: { frequency: "daily", interval: 1 },
        dueTime: "09:00",
      }),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

describe("updateTask (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner can update title, notes, dueTime, and assignee", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const assignee = await createProfile();
    ids.profiles.push(assignee.id);
    const mAssignee = await createMembership({
      household_id: household.id,
      profile_id: assignee.id,
      role: "family_member",
    });
    ids.memberships.push(mAssignee.id);

    // Seed a daily task directly via service client to skip the create round-trip.
    const taskId = randomUUID();
    const insertErr = await serviceClient()
      .from("tasks")
      .insert({
        id: taskId,
        household_id: household.id,
        title: "Original",
        notes: null,
        recurrence_frequency: "daily",
        recurrence_interval: 1,
        due_time: "07:00:00",
        created_by_profile_id: owner.id,
      });
    expect(insertErr.error).toBeNull();
    ids.tasks.push(taskId);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateTask } = await import("@/app/tasks/actions");

    const result = await updateTask({
      taskId,
      title: "Renamed",
      notes: "Now with a note",
      assignedToProfileId: assignee.id,
      dueTime: "21:15",
    });
    expect(result.ok).toBe(true);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("title,notes,assigned_to_profile_id,due_time,recurrence_frequency")
      .eq("id", taskId)
      .single();
    expect(row?.title).toBe("Renamed");
    expect(row?.notes).toBe("Now with a note");
    expect(row?.assigned_to_profile_id).toBe(assignee.id);
    expect(row?.due_time).toBe("21:15:00");
    // Frequency untouched (no recurrence in payload).
    expect(row?.recurrence_frequency).toBe("daily");
  });

  it("owner can change frequency daily → weekly, clearing/setting frequency-specific cols", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);

    const taskId = randomUUID();
    const insertErr = await serviceClient()
      .from("tasks")
      .insert({
        id: taskId,
        household_id: household.id,
        title: "Mop floor",
        recurrence_frequency: "daily",
        recurrence_interval: 1,
        recurrence_byweekday: null,
        recurrence_bymonthday: null,
        due_time: "10:00:00",
        created_by_profile_id: owner.id,
      });
    expect(insertErr.error).toBeNull();
    ids.tasks.push(taskId);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateTask } = await import("@/app/tasks/actions");

    const result = await updateTask({
      taskId,
      recurrence: { frequency: "weekly", interval: 2, byweekday: [0, 6] },
    });
    expect(result.ok).toBe(true);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select(
        "recurrence_frequency,recurrence_interval,recurrence_byweekday,recurrence_bymonthday",
      )
      .eq("id", taskId)
      .single();
    expect(row?.recurrence_frequency).toBe("weekly");
    expect(row?.recurrence_interval).toBe(2);
    expect(row?.recurrence_byweekday).toEqual([0, 6]);
    expect(row?.recurrence_bymonthday).toBeNull();
  });

  it("family_member cannot update a task (RLS blocks UPDATE; owner/maid only)", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const fam = await createProfile();
    ids.profiles.push(fam.id);
    const mFam = await createMembership({
      household_id: household.id,
      profile_id: fam.id,
      role: "family_member",
    });
    ids.memberships.push(mFam.id);

    const taskId = randomUUID();
    const insertErr = await serviceClient()
      .from("tasks")
      .insert({
        id: taskId,
        household_id: household.id,
        title: "Original",
        recurrence_frequency: "daily",
        recurrence_interval: 1,
        due_time: "07:00:00",
        created_by_profile_id: owner.id,
      });
    expect(insertErr.error).toBeNull();
    ids.tasks.push(taskId);

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { updateTask } = await import("@/app/tasks/actions");

    // RLS blocks the row; PostgREST returns the update with 0 rows affected
    // and no error (silent no-op for update under RLS). The action returns ok,
    // but the row should NOT be mutated. This documents the existing behaviour
    // and pins it down so a regression that *did* mutate the row would fail.
    await updateTask({ taskId, title: "Hacked" });

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("title")
      .eq("id", taskId)
      .single();
    expect(row?.title).toBe("Original");
  });

  it("user from a different household cannot update (RLS isolation)", async () => {
    // Household A with its task.
    const { owner: ownerA, household: hA } = await seedOwnerHousehold(ids);
    const taskId = randomUUID();
    const insertErr = await serviceClient()
      .from("tasks")
      .insert({
        id: taskId,
        household_id: hA.id,
        title: "A's task",
        recurrence_frequency: "daily",
        recurrence_interval: 1,
        due_time: "07:00:00",
        created_by_profile_id: ownerA.id,
      });
    expect(insertErr.error).toBeNull();
    ids.tasks.push(taskId);

    // Separate owner B in their own household.
    const { owner: ownerB } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: ownerB.clerk_user_id });
    mockNextStubs();
    const { updateTask } = await import("@/app/tasks/actions");

    // Same silent-no-op semantics as the family_member case: RLS hides the
    // row from B's UPDATE, so the action returns ok with zero rows mutated.
    await updateTask({ taskId, title: "Hijacked by B" });

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("title")
      .eq("id", taskId)
      .single();
    expect(row?.title).toBe("A's task");
  });
});
