// Integration tests for the admin server actions that manage the standard-task
// library. "Standard tasks" are public.tasks rows with household_id IS NULL —
// there is no separate standard_tasks table. The seed migration
// 20260603_001_standard_tasks_seed.sql already inserts a baseline set of
// standard tasks; tests below assert only on rows they created themselves.
//
// requireAdmin() is gated on profiles.is_admin. createProfile() inserts with
// is_admin = false; we promote test admins via a service-role UPDATE.

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClerk, mockClerkUnauthed } from "../helpers/clerk";
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
  tasks: string[];
};

function freshIds(): Ids {
  return { profiles: [], households: [], memberships: [], tasks: [] };
}

async function cleanupAll(ids: Ids): Promise<void> {
  // task_occurrences cascade-delete with the parent task.
  await cleanupRows("tasks", ids.tasks.splice(0));
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

/** Insert an admin profile (is_admin = true). */
async function createAdminProfile(): Promise<{ id: string; clerk_user_id: string }> {
  const p = await createProfile();
  const { error } = await serviceClient()
    .from("profiles")
    .update({ is_admin: true })
    .eq("id", p.id);
  if (error) throw new Error(`promote-to-admin failed: ${error.message}`);
  return p;
}

describe("createStandardTask (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("admin can create a standard task with the minimum required fields", async () => {
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { createStandardTask } = await import("@/app/admin/tasks/actions");

    const result = await createStandardTask({
      title: "Wipe down the front door",
      recurrence: { frequency: "daily", interval: 1 },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    ids.tasks.push(result.data.taskId);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select(
        "household_id,title,notes,recurrence_frequency,recurrence_interval,recurrence_byweekday,recurrence_bymonthday,due_time,archived_at",
      )
      .eq("id", result.data.taskId)
      .single();
    // The signature property of a standard task: household_id IS NULL.
    expect(row?.household_id).toBeNull();
    expect(row?.title).toBe("Wipe down the front door");
    expect(row?.notes).toBeNull();
    expect(row?.recurrence_frequency).toBe("daily");
    expect(row?.recurrence_interval).toBe(1);
    expect(row?.recurrence_byweekday).toBeNull();
    expect(row?.recurrence_bymonthday).toBeNull();
    // PostgREST normalises HH:MM → HH:MM:SS, matching the action's own pad.
    expect(row?.due_time).toBe("09:00:00");
    expect(row?.archived_at).toBeNull();
  });

  it("admin can create a standard task with all optional fields populated", async () => {
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { createStandardTask } = await import("@/app/admin/tasks/actions");

    const result = await createStandardTask({
      title: "Deep-clean range hood",
      notes: "Soak filters in degreaser before scrubbing.",
      recurrence: {
        frequency: "monthly",
        interval: 2,
        bymonthday: 10,
        startsOn: "2026-06-01",
        endsOn: "2027-06-01",
      },
      dueTime: "10:30:00",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    ids.tasks.push(result.data.taskId);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select(
        "household_id,title,notes,recurrence_frequency,recurrence_interval,recurrence_byweekday,recurrence_bymonthday,recurrence_starts_on,recurrence_ends_on,due_time",
      )
      .eq("id", result.data.taskId)
      .single();
    expect(row?.household_id).toBeNull();
    expect(row?.title).toBe("Deep-clean range hood");
    expect(row?.notes).toBe("Soak filters in degreaser before scrubbing.");
    expect(row?.recurrence_frequency).toBe("monthly");
    expect(row?.recurrence_interval).toBe(2);
    expect(row?.recurrence_byweekday).toBeNull();
    expect(row?.recurrence_bymonthday).toBe(10);
    expect(row?.recurrence_starts_on).toBe("2026-06-01");
    expect(row?.recurrence_ends_on).toBe("2027-06-01");
    expect(row?.due_time).toBe("10:30:00");
  });

  it("non-admin (regular owner) is redirected to /dashboard by requireAdmin", async () => {
    // Plain profile, no is_admin promotion.
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

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createStandardTask } = await import("@/app/admin/tasks/actions");

    // requireAdmin() calls redirect("/dashboard"), which our next/navigation
    // stub raises as a NEXT_REDIRECT error. Assert on that digest.
    await expectRedirect(
      createStandardTask({
        title: "Sneaky standard task",
        recurrence: { frequency: "daily", interval: 1 },
        dueTime: "09:00",
      }),
      "/dashboard",
    );

    // And verify nothing was written.
    const { data: leaked } = await serviceClient()
      .from("tasks")
      .select("id")
      .is("household_id", null)
      .eq("title", "Sneaky standard task");
    expect(leaked ?? []).toHaveLength(0);
  });

  it("anonymous (signed-out) caller is rejected before requireAdmin returns", async () => {
    mockClerkUnauthed();
    mockNextStubs();
    const { createStandardTask } = await import("@/app/admin/tasks/actions");

    // getCurrentProfile() throws "not authenticated" when there is no Clerk
    // userId. requireAdmin() bubbles that out (no redirect — the throw beats
    // the is_admin check). Either way, the action MUST NOT succeed.
    await expect(
      createStandardTask({
        title: "Anon standard task",
        recurrence: { frequency: "daily", interval: 1 },
        dueTime: "09:00",
      }),
    ).rejects.toThrow(/not authenticated/);

    const { data: leaked } = await serviceClient()
      .from("tasks")
      .select("id")
      .is("household_id", null)
      .eq("title", "Anon standard task");
    expect(leaked ?? []).toHaveLength(0);
  });

  it("rejects weekly recurrence missing byweekday with ADMIN_TASK_INVALID", async () => {
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { createStandardTask } = await import("@/app/admin/tasks/actions");

    const result = await createStandardTask({
      title: "Bad weekly",
      recurrence: { frequency: "weekly", interval: 1 },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("ADMIN_TASK_INVALID");
  });

  it("rejects empty title with ADMIN_TASK_INVALID (Zod min(1))", async () => {
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { createStandardTask } = await import("@/app/admin/tasks/actions");

    const result = await createStandardTask({
      title: "   ", // trims to empty
      recurrence: { frequency: "daily", interval: 1 },
      dueTime: "09:00",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("ADMIN_TASK_INVALID");
  });

  it("rejects malformed dueTime with ADMIN_TASK_INVALID", async () => {
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { createStandardTask } = await import("@/app/admin/tasks/actions");

    const result = await createStandardTask({
      title: "Bad due time",
      recurrence: { frequency: "daily", interval: 1 },
      // Not HH:MM or HH:MM:SS — Zod regex rejects.
      dueTime: "9am",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("ADMIN_TASK_INVALID");
  });
});

describe("archiveStandardTask (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  /** Seed a fresh standard task via the service client and return its id. */
  async function seedStandardTask(title: string): Promise<string> {
    const taskId = randomUUID();
    const { error } = await serviceClient()
      .from("tasks")
      .insert({
        id: taskId,
        household_id: null,
        title,
        recurrence_frequency: "daily",
        recurrence_interval: 1,
        due_time: "09:00:00",
      } as never);
    if (error) throw new Error(`seedStandardTask failed: ${error.message}`);
    ids.tasks.push(taskId);
    return taskId;
  }

  it("admin can archive a standard task and the row's archived_at becomes non-null", async () => {
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);
    const taskId = await seedStandardTask("To be archived");

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { archiveStandardTask } = await import("@/app/admin/tasks/actions");

    const result = await archiveStandardTask({ taskId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.taskId).toBe(taskId);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("id,archived_at,household_id")
      .eq("id", taskId)
      .single();
    expect(row?.household_id).toBeNull();
    expect(row?.archived_at).not.toBeNull();
  });

  it("archived standard task is filtered out by the wizard's standard-task query", async () => {
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);
    const taskId = await seedStandardTask("Wizard-visible until archived");

    // Sanity: pre-archive, the wizard's exact filter sees this row.
    {
      const { data: before } = await serviceClient()
        .from("tasks")
        .select("id")
        .is("household_id", null)
        .is("archived_at", null)
        .eq("id", taskId);
      expect(before ?? []).toHaveLength(1);
    }

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { archiveStandardTask } = await import("@/app/admin/tasks/actions");
    const result = await archiveStandardTask({ taskId });
    expect(result.ok).toBe(true);

    // The wizard at src/app/onboarding/tasks/page.tsx selects standard tasks
    // with .is("household_id", null).is("archived_at", null) — verify the
    // archived row is excluded by that same predicate.
    const { data: after } = await serviceClient()
      .from("tasks")
      .select("id")
      .is("household_id", null)
      .is("archived_at", null)
      .eq("id", taskId);
    expect(after ?? []).toHaveLength(0);
  });

  it("non-admin (regular owner) is redirected and the row is not archived", async () => {
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
    const taskId = await seedStandardTask("Survives non-admin");

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { archiveStandardTask } = await import("@/app/admin/tasks/actions");

    await expectRedirect(archiveStandardTask({ taskId }), "/dashboard");

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("archived_at")
      .eq("id", taskId)
      .single();
    expect(row?.archived_at).toBeNull();
  });

  it("rejects invalid taskId (non-UUID) with ADMIN_TASK_INVALID before touching the DB", async () => {
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { archiveStandardTask } = await import("@/app/admin/tasks/actions");

    const result = await archiveStandardTask({ taskId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error.code).toBe("ADMIN_TASK_INVALID");
  });

  it("archiving a non-existent (but well-formed) UUID succeeds as a no-op", async () => {
    // The action's update is filtered by .eq("id", ...).is("household_id", null);
    // a missing row yields zero rows updated and no PostgREST error. The action
    // returns ok in that case. This pins down the graceful-failure behaviour.
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { archiveStandardTask } = await import("@/app/admin/tasks/actions");

    const ghostId = randomUUID();
    const result = await archiveStandardTask({ taskId: ghostId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.taskId).toBe(ghostId);

    // And no phantom row materialised.
    const { data: row } = await serviceClient()
      .from("tasks")
      .select("id")
      .eq("id", ghostId)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("archive on a household-owned task is a no-op (household_id IS NULL filter protects user data)", async () => {
    // Defense-in-depth: the action's update is scoped to household_id IS NULL,
    // so even an admin can't accidentally archive a household's private task
    // through this code path.
    const admin = await createAdminProfile();
    ids.profiles.push(admin.id);
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

    const taskId = randomUUID();
    const { error: insErr } = await serviceClient()
      .from("tasks")
      .insert({
        id: taskId,
        household_id: h.id,
        title: "Owner's private task",
        recurrence_frequency: "daily",
        recurrence_interval: 1,
        due_time: "09:00:00",
        created_by_profile_id: owner.id,
      } as never);
    expect(insErr).toBeNull();
    ids.tasks.push(taskId);

    mockClerk({ clerkUserId: admin.clerk_user_id });
    mockNextStubs();
    const { archiveStandardTask } = await import("@/app/admin/tasks/actions");

    const result = await archiveStandardTask({ taskId });
    expect(result.ok).toBe(true);

    const { data: row } = await serviceClient()
      .from("tasks")
      .select("archived_at")
      .eq("id", taskId)
      .single();
    expect(row?.archived_at).toBeNull();
  });
});
