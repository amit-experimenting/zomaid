// Supabase HTTP test client + committed-write factories for action tests.
// Action code talks to Supabase over real HTTP, so pg-based factories (whose
// writes roll back) are invisible to it. These helpers seed via the
// service-role REST client; tests are responsible for cleanup.
//
// REQUIRED ENV (set in .env.local or shell before running action tests):
//   NEXT_PUBLIC_SUPABASE_URL          (defaulted in tests/setup.ts)
//   NEXT_PUBLIC_SUPABASE_ANON_KEY     (read by code under test)
//   SUPABASE_SERVICE_ROLE_KEY         (used by this module)
// The anon/service keys are emitted by `pnpm db:start` / `supabase status`
// and change per Supabase CLI version, so we read them lazily and throw a
// helpful error only when an action-test actually constructs a client.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/db/types";
import type {
  ProfileRow,
  HouseholdRow,
  MembershipRow,
  InviteRow,
} from "../factories";

export type {
  ProfileRow,
  HouseholdRow,
  MembershipRow,
  InviteRow,
} from "../factories";

type TypedClient = SupabaseClient<Database>;

let cached: { url: string; key: string; client: TypedClient } | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Action tests require Supabase HTTP credentials. ` +
        `Run \`pnpm db:start\` and copy the anon + service_role keys into ` +
        `.env.local (or export them in your shell) before running tests.`,
    );
  }
  return v;
}

/**
 * Service-role Supabase HTTP client for test setup and assertions. Bypasses
 * RLS. Memoized per (url, key) tuple so vi.resetModules() doesn't force a
 * reconnect every test.
 */
export function serviceClient(): TypedClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (cached && cached.url === url && cached.key === key) {
    return cached.client;
  }
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cached = { url, key, client };
  return client;
}

/** Delete rows from `table` by id via the service-role client. */
export async function cleanupRows(
  table:
    | "profiles"
    | "households"
    | "household_memberships"
    | "invites"
    | "tasks"
    | "task_occurrences",
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await serviceClient().from(table).delete().in("id", ids);
  if (error) {
    throw new Error(`cleanupRows(${table}) failed: ${error.message}`);
  }
}

export async function createProfile(
  overrides: Partial<ProfileRow> = {},
): Promise<ProfileRow> {
  const row: ProfileRow = {
    id: overrides.id ?? randomUUID(),
    clerk_user_id: overrides.clerk_user_id ?? `user_${randomUUID()}`,
    email: overrides.email ?? `${randomUUID()}@example.com`,
    display_name: overrides.display_name ?? "Test User",
    is_admin: overrides.is_admin ?? false,
  };
  // Insert type omits id, but the DB column accepts an explicit value; cast
  // through so tests can pin a known UUID for assertions.
  const { error } = await serviceClient()
    .from("profiles")
    .insert(row as never);
  if (error) throw new Error(`createProfile failed: ${error.message}`);
  return row;
}

export async function createHousehold(
  overrides: Partial<HouseholdRow> & { created_by_profile_id: string },
): Promise<HouseholdRow> {
  const row: HouseholdRow = {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? "Test Household",
    address_line: overrides.address_line ?? null,
    postal_code: overrides.postal_code ?? null,
    created_by_profile_id: overrides.created_by_profile_id,
  };
  const { error } = await serviceClient()
    .from("households")
    .insert(row as never);
  if (error) throw new Error(`createHousehold failed: ${error.message}`);
  return row;
}

export async function createMembership(
  overrides: Partial<MembershipRow> & {
    household_id: string;
    profile_id: string;
    role: MembershipRow["role"];
  },
): Promise<MembershipRow> {
  const row: MembershipRow = {
    id: overrides.id ?? randomUUID(),
    household_id: overrides.household_id,
    profile_id: overrides.profile_id,
    role: overrides.role,
    privilege: overrides.privilege ?? "full",
    status: overrides.status ?? "active",
  };
  const { error } = await serviceClient()
    .from("household_memberships")
    .insert(row as never);
  if (error) throw new Error(`createMembership failed: ${error.message}`);
  return row;
}

export async function createInvite(
  overrides: Partial<InviteRow> & {
    household_id: string;
    invited_by_profile_id: string;
    intended_role: InviteRow["intended_role"];
  },
): Promise<InviteRow> {
  const code =
    overrides.code ?? String(Math.floor(100000 + Math.random() * 900000));
  const token =
    overrides.token ??
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  // Default expiry: 7 days out. Tests can override with an ISO string; SQL
  // expressions (like the pg factory accepts) are NOT supported here because
  // PostgREST takes a literal value.
  const expires_at =
    overrides.expires_at ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const row: InviteRow = {
    id: overrides.id ?? randomUUID(),
    household_id: overrides.household_id,
    invited_by_profile_id: overrides.invited_by_profile_id,
    intended_role: overrides.intended_role,
    intended_privilege: overrides.intended_privilege ?? null,
    code,
    token,
    expires_at,
    consumed_at: overrides.consumed_at ?? null,
    consumed_by_profile_id: overrides.consumed_by_profile_id ?? null,
  };
  const { error } = await serviceClient()
    .from("invites")
    .insert(row as never);
  if (error) throw new Error(`createInvite failed: ${error.message}`);
  return row;
}
