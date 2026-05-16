// Integration tests for GET /api/cron/dispatch-task-pushes. The route handler
// runs against a real local Supabase (seeded via the service-role client) but
// the actual web-push delivery is stubbed via vi.mock so no real push endpoint
// is ever contacted. The handler doesn't use Clerk (cron-only, bearer-gated),
// so we skip the Clerk mock and just exercise the route directly.

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupRows,
  createHousehold,
  createMembership,
  createProfile,
  serviceClient,
} from "../helpers/supabase-test-client";

// Mock the web-push wrapper. The default behaviour is "delivered ok"; per-test
// overrides install other behaviours (gone, transient error, etc).
const sendWebPushMock = vi.fn();
vi.mock("@/lib/push/webpush", () => ({
  sendWebPush: (...args: unknown[]) => sendWebPushMock(...args),
}));

const TEST_CRON_SECRET = "test-cron-secret-for-route-tests";

type Ids = {
  profiles: string[];
  households: string[];
  memberships: string[];
  tasks: string[];
  pushSubscriptions: string[];
};

function freshIds(): Ids {
  return {
    profiles: [],
    households: [],
    memberships: [],
    tasks: [],
    pushSubscriptions: [],
  };
}

async function cleanupAll(ids: Ids): Promise<void> {
  // push_subscriptions are independent of tasks; clean them via service client
  // directly (cleanupRows whitelist doesn't include them).
  if (ids.pushSubscriptions.length > 0) {
    const { error } = await serviceClient()
      .from("push_subscriptions")
      .delete()
      .in("id", ids.pushSubscriptions.splice(0));
    if (error) throw new Error(`cleanup push_subscriptions failed: ${error.message}`);
  }
  // task_occurrences cascade with the parent task, so deleting tasks is enough.
  await cleanupRows("tasks", ids.tasks.splice(0));
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

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

async function seedTaskWithDueOccurrence(opts: {
  ids: Ids;
  householdId: string;
  ownerId: string;
  assigneeId?: string | null;
  dueAt?: Date;
  notifiedAt?: Date | null;
  title?: string;
}): Promise<{ taskId: string; occurrenceId: string }> {
  const taskId = randomUUID();
  const occurrenceId = randomUUID();
  const { error: taskErr } = await serviceClient()
    .from("tasks")
    .insert({
      id: taskId,
      household_id: opts.householdId,
      title: opts.title ?? "Task that is due",
      assigned_to_profile_id: opts.assigneeId ?? null,
      recurrence_frequency: "daily",
      recurrence_interval: 1,
      due_time: "09:00:00",
      created_by_profile_id: opts.ownerId,
    } as never);
  if (taskErr) throw new Error(`seed task failed: ${taskErr.message}`);
  opts.ids.tasks.push(taskId);

  const dueAt = opts.dueAt ?? new Date(Date.now() - 60_000);
  const { error: occErr } = await serviceClient()
    .from("task_occurrences")
    .insert({
      id: occurrenceId,
      task_id: taskId,
      household_id: opts.householdId,
      due_at: dueAt.toISOString(),
      status: "pending",
      notified_at: opts.notifiedAt ? opts.notifiedAt.toISOString() : null,
    } as never);
  if (occErr) throw new Error(`seed occurrence failed: ${occErr.message}`);
  return { taskId, occurrenceId };
}

async function seedPushSubscription(opts: {
  ids: Ids;
  profileId: string;
  endpoint?: string;
}): Promise<string> {
  const id = randomUUID();
  const endpoint =
    opts.endpoint ?? `https://example.test/push/${randomUUID()}`;
  const { error } = await serviceClient()
    .from("push_subscriptions")
    .insert({
      id,
      profile_id: opts.profileId,
      endpoint,
      p256dh_key: `p256dh_${randomUUID()}`,
      auth_key: `auth_${randomUUID()}`,
    } as never);
  if (error) throw new Error(`seed push_subscription failed: ${error.message}`);
  opts.ids.pushSubscriptions.push(id);
  return id;
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/cron/dispatch-task-pushes", {
    method: "GET",
    headers,
  });
}

describe("GET /api/cron/dispatch-task-pushes — auth gate", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
    sendWebPushMock.mockReset();
    sendWebPushMock.mockResolvedValue({ ok: true });
    process.env.CRON_SECRET = TEST_CRON_SECRET;
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
    expect(sendWebPushMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token doesn't match CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(
      makeRequest({ authorization: "Bearer wrong-secret" }),
    );
    expect(res.status).toBe(401);
    expect(sendWebPushMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the correct bearer token (no work to do)", async () => {
    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(
      makeRequest({ authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Whatever else exists in the DB, this household has no work; the route
    // returns processed:0 when there's nothing due. Other rows belonging to
    // parallel-running tests can change the count, so just assert the shape.
    expect(body).toHaveProperty("processed");
  });
});

describe("GET /api/cron/dispatch-task-pushes — dispatch behaviour", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
    sendWebPushMock.mockReset();
    sendWebPushMock.mockResolvedValue({ ok: true });
    process.env.CRON_SECRET = TEST_CRON_SECRET;
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("dispatches one push per active subscription for a due, unnotified occurrence and stamps notified_at", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { occurrenceId } = await seedTaskWithDueOccurrence({
      ids,
      householdId: household.id,
      ownerId: owner.id,
      assigneeId: owner.id,
      title: "Take out the trash",
    });
    const ownerEndpoint = `https://example.test/push/owner-${randomUUID()}`;
    await seedPushSubscription({
      ids,
      profileId: owner.id,
      endpoint: ownerEndpoint,
    });

    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(
      makeRequest({ authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);

    // The mock may have been called for other due occurrences seeded by
    // sibling tests; assert at least that ours fired with the right shape.
    const ourCall = sendWebPushMock.mock.calls.find(
      ([sub]) => (sub as { endpoint: string }).endpoint === ownerEndpoint,
    );
    expect(ourCall).toBeDefined();
    const [subscription, payload] = ourCall!;
    expect(subscription).toMatchObject({
      endpoint: ownerEndpoint,
      keys: { p256dh: expect.any(String), auth: expect.any(String) },
    });
    expect(payload).toMatchObject({
      title: "Take out the trash",
      // Assigned to owner, whose default display_name is "Test User"
      body: "Due now — for Test User",
      data: { occurrenceId },
    });

    const { data: occ } = await serviceClient()
      .from("task_occurrences")
      .select("notified_at")
      .eq("id", occurrenceId)
      .single();
    expect(occ?.notified_at).not.toBeNull();
  });

  it("does not re-dispatch occurrences that already have notified_at set", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    await seedTaskWithDueOccurrence({
      ids,
      householdId: household.id,
      ownerId: owner.id,
      assigneeId: owner.id,
      // Already notified an hour ago.
      notifiedAt: new Date(Date.now() - 60 * 60_000),
      title: "Already notified task",
    });
    const ourEndpoint = `https://example.test/push/already-${randomUUID()}`;
    await seedPushSubscription({
      ids,
      profileId: owner.id,
      endpoint: ourEndpoint,
    });

    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(
      makeRequest({ authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);

    // Our specific subscription should never have been pinged.
    const calledForUs = sendWebPushMock.mock.calls.some(
      ([sub]) => (sub as { endpoint: string }).endpoint === ourEndpoint,
    );
    expect(calledForUs).toBe(false);
  });

  it("dispatches a separate push for each active subscription belonging to the same user", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    await seedTaskWithDueOccurrence({
      ids,
      householdId: household.id,
      ownerId: owner.id,
      assigneeId: owner.id,
      title: "Multi-device user",
    });
    const phoneEndpoint = `https://example.test/push/phone-${randomUUID()}`;
    const laptopEndpoint = `https://example.test/push/laptop-${randomUUID()}`;
    await seedPushSubscription({
      ids,
      profileId: owner.id,
      endpoint: phoneEndpoint,
    });
    await seedPushSubscription({
      ids,
      profileId: owner.id,
      endpoint: laptopEndpoint,
    });

    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(
      makeRequest({ authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);

    const endpointsCalled = sendWebPushMock.mock.calls
      .map(([sub]) => (sub as { endpoint: string }).endpoint);
    expect(endpointsCalled).toContain(phoneEndpoint);
    expect(endpointsCalled).toContain(laptopEndpoint);
  });

  it("marks the subscription revoked when sendWebPush reports gone: true", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    await seedTaskWithDueOccurrence({
      ids,
      householdId: household.id,
      ownerId: owner.id,
      assigneeId: owner.id,
      title: "Gone-sub task",
    });
    const deadEndpoint = `https://example.test/push/dead-${randomUUID()}`;
    const deadSubId = await seedPushSubscription({
      ids,
      profileId: owner.id,
      endpoint: deadEndpoint,
    });

    // The default mock returns ok:true for other endpoints; for the dead
    // endpoint, return gone:true (mirrors a 410 from the push service).
    sendWebPushMock.mockImplementation(
      async (sub: { endpoint: string }) => {
        if (sub.endpoint === deadEndpoint) {
          return { ok: false, gone: true, status: 410, message: "Gone" };
        }
        return { ok: true };
      },
    );

    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(
      makeRequest({ authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);

    const { data: sub } = await serviceClient()
      .from("push_subscriptions")
      .select("revoked_at")
      .eq("id", deadSubId)
      .single();
    expect(sub?.revoked_at).not.toBeNull();
  });

  it("does not dispatch for occurrences whose due_at is in the future", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    await seedTaskWithDueOccurrence({
      ids,
      householdId: household.id,
      ownerId: owner.id,
      assigneeId: owner.id,
      // Due 1 hour from now.
      dueAt: new Date(Date.now() + 60 * 60_000),
      title: "Future task",
    });
    const futureEndpoint = `https://example.test/push/future-${randomUUID()}`;
    await seedPushSubscription({
      ids,
      profileId: owner.id,
      endpoint: futureEndpoint,
    });

    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(
      makeRequest({ authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);

    const calledForUs = sendWebPushMock.mock.calls.some(
      ([sub]) => (sub as { endpoint: string }).endpoint === futureEndpoint,
    );
    expect(calledForUs).toBe(false);
  });

  it("still stamps notified_at when the household has zero active push subscriptions (avoids retry loop)", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    // Note: no push_subscriptions seeded for this household.
    const { occurrenceId } = await seedTaskWithDueOccurrence({
      ids,
      householdId: household.id,
      ownerId: owner.id,
      assigneeId: owner.id,
      title: "Nobody-to-tell task",
    });

    const { GET } = await import("@/app/api/cron/dispatch-task-pushes/route");
    const res = await GET(
      makeRequest({ authorization: `Bearer ${TEST_CRON_SECRET}` }),
    );
    expect(res.status).toBe(200);

    const { data: occ } = await serviceClient()
      .from("task_occurrences")
      .select("notified_at")
      .eq("id", occurrenceId)
      .single();
    expect(occ?.notified_at).not.toBeNull();
  });
});
