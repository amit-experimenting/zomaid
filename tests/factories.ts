import type { Client } from "pg";
import { randomUUID } from "node:crypto";

export type ProfileRow = {
  id: string;
  clerk_user_id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
};

export async function insertProfile(
  client: Client,
  overrides: Partial<ProfileRow> = {},
): Promise<ProfileRow> {
  const row = {
    id: overrides.id ?? randomUUID(),
    clerk_user_id: overrides.clerk_user_id ?? `user_${randomUUID()}`,
    email: overrides.email ?? `${randomUUID()}@example.com`,
    display_name: overrides.display_name ?? "Test User",
    is_admin: overrides.is_admin ?? false,
  };
  await client.query(
    `insert into profiles
      (id, clerk_user_id, email, display_name, is_admin)
     values ($1,$2,$3,$4,$5)`,
    [
      row.id,
      row.clerk_user_id,
      row.email,
      row.display_name,
      row.is_admin,
    ],
  );
  return row;
}

export type HouseholdRow = {
  id: string;
  name: string;
  address_line: string | null;
  postal_code: string | null;
  created_by_profile_id: string;
};

export async function insertHousehold(
  client: Client,
  overrides: Partial<HouseholdRow> & { created_by_profile_id: string },
): Promise<HouseholdRow> {
  const row = {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? "Test Household",
    address_line: overrides.address_line ?? null,
    postal_code: overrides.postal_code ?? null,
    created_by_profile_id: overrides.created_by_profile_id,
  };
  await client.query(
    `insert into households
      (id, name, address_line, postal_code, created_by_profile_id)
     values ($1,$2,$3,$4,$5)`,
    [row.id, row.name, row.address_line, row.postal_code, row.created_by_profile_id],
  );
  return row;
}

export type MembershipRow = {
  id: string;
  household_id: string;
  profile_id: string;
  role: "owner" | "family_member" | "maid";
  privilege: "full" | "meal_modify" | "view_only";
  status: "active" | "pending" | "removed";
};

export async function insertMembership(
  client: Client,
  overrides: Partial<MembershipRow> & {
    household_id: string;
    profile_id: string;
    role: MembershipRow["role"];
  },
): Promise<MembershipRow> {
  const row = {
    id: overrides.id ?? randomUUID(),
    household_id: overrides.household_id,
    profile_id: overrides.profile_id,
    role: overrides.role,
    privilege: overrides.privilege ?? "full",
    status: overrides.status ?? "active",
  };
  await client.query(
    `insert into household_memberships
      (id, household_id, profile_id, role, privilege, status)
     values ($1,$2,$3,$4,$5,$6)`,
    [row.id, row.household_id, row.profile_id, row.role, row.privilege, row.status],
  );
  return row;
}

export type InviteRow = {
  id: string;
  household_id: string;
  invited_by_profile_id: string;
  intended_role: "owner" | "family_member" | "maid";
  intended_privilege: "full" | "meal_modify" | "view_only" | null;
  code: string;
  token: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by_profile_id: string | null;
};

export async function insertInvite(
  client: Client,
  overrides: Partial<InviteRow> & {
    household_id: string;
    invited_by_profile_id: string;
    intended_role: InviteRow["intended_role"];
  },
): Promise<InviteRow> {
  const code =
    overrides.code ??
    String(Math.floor(100000 + Math.random() * 900000));
  const token = overrides.token ?? randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const row = {
    id: overrides.id ?? randomUUID(),
    household_id: overrides.household_id,
    invited_by_profile_id: overrides.invited_by_profile_id,
    intended_role: overrides.intended_role,
    intended_privilege: overrides.intended_privilege ?? null,
    code,
    token,
    expires_at: overrides.expires_at ?? "now() + interval '7 days'",
    consumed_at: overrides.consumed_at ?? null,
    consumed_by_profile_id: overrides.consumed_by_profile_id ?? null,
  };
  // expires_at can be either an ISO string or a SQL expression; handle both.
  if (overrides.expires_at && /^\d{4}-/.test(overrides.expires_at)) {
    await client.query(
      `insert into invites
        (id, household_id, invited_by_profile_id, intended_role, intended_privilege,
         code, token, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.id, row.household_id, row.invited_by_profile_id, row.intended_role,
       row.intended_privilege, row.code, row.token, overrides.expires_at],
    );
  } else if (overrides.expires_at) {
    // SQL expression like "now() - interval '1 minute'"
    await client.query(
      `insert into invites
        (id, household_id, invited_by_profile_id, intended_role, intended_privilege,
         code, token, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7, ${overrides.expires_at})`,
      [row.id, row.household_id, row.invited_by_profile_id, row.intended_role,
       row.intended_privilege, row.code, row.token],
    );
  } else {
    await client.query(
      `insert into invites
        (id, household_id, invited_by_profile_id, intended_role, intended_privilege,
         code, token)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [row.id, row.household_id, row.invited_by_profile_id, row.intended_role,
       row.intended_privilege, row.code, row.token],
    );
  }
  return row;
}
