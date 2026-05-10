import type { Client } from "pg";
import { randomUUID } from "node:crypto";

export type ProfileRow = {
  id: string;
  clerk_user_id: string;
  email: string;
  display_name: string;
  locale: string;
  timezone: string;
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
    locale: overrides.locale ?? "en-SG",
    timezone: overrides.timezone ?? "Asia/Singapore",
    is_admin: overrides.is_admin ?? false,
  };
  await client.query(
    `insert into profiles
      (id, clerk_user_id, email, display_name, locale, timezone, is_admin)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      row.id,
      row.clerk_user_id,
      row.email,
      row.display_name,
      row.locale,
      row.timezone,
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
