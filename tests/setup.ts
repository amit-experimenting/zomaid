import { afterAll, beforeAll, vi } from "vitest";
import { Client } from "pg";

// Local Supabase defaults; overridden by env when running against staging.
const TEST_DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgres://postgres:postgres@127.0.0.1:54322/postgres";

let pool: Client | null = null;

export async function getClient(): Promise<Client> {
  if (!pool) {
    pool = new Client({ connectionString: TEST_DB_URL });
    await pool.connect();
  }
  return pool;
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
  if (pool) {
    await pool.end();
    pool = null;
  }
});

// Silence Next's "Module not found" spam when importing app code in tests.
vi.mock("server-only", () => ({}));
