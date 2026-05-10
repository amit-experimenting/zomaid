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
