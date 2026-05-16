import { afterAll, beforeAll, vi } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vitest doesn't load .env.local automatically the way Next.js does, so
// action tests that need NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
// would fail even when the keys are sitting in .env.local. Read the file
// once at startup and seed any unset vars. Existing env wins (so CI can
// override). Quiet no-op if the file is absent.
try {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, valueRaw] = m;
    if (process.env[key]) continue;
    let v = valueRaw.trim();
    // Strip surrounding quotes if present.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[key] = v;
  }
} catch {
  // .env.local missing or unreadable — fine in CI.
}

// Defaults still apply if neither .env.local nor the shell set them.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_JWT_SECRET ??=
  "super-secret-jwt-token-with-at-least-32-characters-long";

// Local Supabase defaults; overridden by env when running against staging.
const TEST_DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgres://postgres:postgres@127.0.0.1:54322/postgres";

let singleton: Client | null = null;

export async function getClient(): Promise<Client> {
  if (!singleton) {
    singleton = new Client({ connectionString: TEST_DB_URL });
    await singleton.connect();
  }
  return singleton;
}

/**
 * Run `fn` inside a Postgres transaction that always rolls back.
 * Use `setJwtClaims` inside fn to impersonate a user for RLS testing.
 */
export async function withTransaction<T>(
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = await getClient();
  await client.query("BEGIN");
  try {
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
  }
}

/**
 * Simulates the JWT claims Supabase would inject after verifying a Clerk
 * token. Use inside a transaction; effect is local to that transaction.
 */
export async function setJwtClaims(
  client: Client,
  claims: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `select set_config('request.jwt.claims', $1, true),
            set_config('role', 'authenticated', true)`,
    [JSON.stringify(claims)],
  );
}

/**
 * Drops the JWT claims and switches to the anon role for the rest of the
 * current transaction. Use inside a transaction; effect is local to that
 * transaction.
 */
export async function asAnon(client: Client): Promise<void> {
  await client.query(
    `select set_config('request.jwt.claims', '', true),
            set_config('role', 'anon', true)`,
  );
}

beforeAll(async () => {
  process.env.TZ = "Asia/Singapore";
});

afterAll(async () => {
  if (singleton) {
    await singleton.end();
    singleton = null;
  }
});

// Silence Next's "Module not found" spam when importing app code in tests.
vi.mock("server-only", () => ({}));
