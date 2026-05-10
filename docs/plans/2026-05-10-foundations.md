# Zomaid Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Foundations slice end-to-end: identity (Clerk → profiles), households, household_memberships, invites, RLS-enforced multi-tenant authorization, server actions, onboarding UI, and admin env-var sync. After this plan, a maid or an owner can sign in with Gmail, create a household, invite the other party plus family members, redeem invites, manage privileges, and remove members — all gated by Postgres RLS using Clerk's JWT.

**Architecture:** Clerk (Gmail OAuth) issues a JWT that Supabase verifies via its native third-party auth integration. RLS policies use `auth.jwt()->>'sub'` to identify the caller. App-side `@supabase/ssr` clients forward the Clerk session token via the `accessToken` callback. The single RLS-bypassing path is the `redeem_invite(text)` SECURITY DEFINER function. Server actions in `app/(*)/actions.ts` validate inputs with Zod and call the DB.

**Tech stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (base-ui preset) · Clerk v7 · Supabase (`@supabase/ssr` v0.7+, `@supabase/supabase-js` v2) · Postgres 17 (via Supabase) · Zod · svix (Clerk webhook signature verification) · Vitest + node-postgres (`pg`) for DB/integration tests · Playwright for E2E · pnpm 10.

**Spec reference:** [`docs/specs/2026-05-10-foundations-design.md`](../specs/2026-05-10-foundations-design.md) (commit `41ee9e5`).

---

## Pre-flight: external setup (one-time, manual)

These steps require dashboards (browser) — they cannot be automated by this plan. **Do them all before Task 1.** Re-read [the spec §6.2](../specs/2026-05-10-foundations-design.md) for context.

- [ ] **A. Create a Supabase project**

  1. Go to https://supabase.com → New project. Region: `Southeast Asia (Singapore)`.
  2. Save the project URL (looks like `https://xxxxxxx.supabase.co`).
  3. Project Settings → API → copy the **anon** public key and the **service_role** key.

- [ ] **B. Create a Clerk JWT template named `supabase`**

  1. Clerk Dashboard → JWT Templates → New template → Blank.
  2. Name: `supabase`.
  3. Claims (replace the default JSON entirely):

     ```json
     {
       "aud": "authenticated",
       "role": "authenticated",
       "email": "{{user.primary_email_address}}",
       "app_metadata": { "provider": "clerk" },
       "user_metadata": {}
     }
     ```

  4. Save. Copy the **JWKS Endpoint URL** shown on the template page (looks like `https://<your-clerk-host>/.well-known/jwks.json`).

- [ ] **C. Register Clerk as a third-party auth provider in Supabase**

  1. Supabase Studio → Authentication → Sign-In / Up → Third-party Auth → Clerk → Add provider.
  2. Paste Clerk's **Issuer URL** (everything before `/.well-known/jwks.json` from step B).
  3. Save.

- [ ] **D. Create the Clerk webhook endpoint**

  1. Clerk Dashboard → Webhooks → Add endpoint.
  2. URL: `https://<your-app-host>/api/webhooks/clerk` (use a tunneling tool like `ngrok http 3000` for local development; the app implements this endpoint in Task 5).
  3. Subscribe to events: `user.created`, `user.updated`, `user.deleted`.
  4. Copy the **Signing Secret** (starts with `whsec_`).

- [ ] **E. Fill `.env.local`**

  Copy `.env.local.example` → `.env.local` and set:

  ```
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
  CLERK_SECRET_KEY=sk_test_...
  CLERK_WEBHOOK_SIGNING_SECRET=whsec_...

  NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxx.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
  SUPABASE_SERVICE_ROLE_KEY=eyJ...

  ZOMAID_ADMIN_CLERK_USER_IDS=
  ```

  Leave `ZOMAID_ADMIN_CLERK_USER_IDS` empty for v1 dev; populate with your own Clerk user ID once it exists.

When all five checkboxes are ticked, proceed to Task 1.

---

## File-structure recap

See the layout above the plan header. Each task lists the exact files it creates or modifies.

---

## Task 1: Add dev dependencies and configure Vitest + Playwright

**Files:**

- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `tests/setup.ts`

- [ ] **Step 1: Install dev dependencies**

  Run:

  ```bash
  pnpm add -D vitest @vitest/ui @types/node-postgres pg jsonwebtoken @types/jsonwebtoken @playwright/test svix
  ```

  Then install Playwright browsers:

  ```bash
  pnpm exec playwright install chromium
  ```

  (svix is a runtime dep used by Task 5's webhook handler, but installing it now keeps it grouped with tooling. We'll move it to `dependencies` in Task 5's commit.)

- [ ] **Step 2: Add scripts to `package.json`**

  In `package.json`, replace the `scripts` block with:

  ```json
  "scripts": {
    "dev": "next dev",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:diff": "supabase db diff -f",
    "db:push": "supabase db push"
  }
  ```

  Note: `build` uses `--webpack` because Serwist's plugin requires webpack; see the spec scaffold notes.

- [ ] **Step 3: Create `vitest.config.ts`**

  ```ts
  import { defineConfig } from "vitest/config";
  import path from "node:path";

  export default defineConfig({
    test: {
      environment: "node",
      setupFiles: ["./tests/setup.ts"],
      testTimeout: 15_000,
      hookTimeout: 15_000,
      include: ["tests/**/*.test.ts"],
      exclude: ["tests/e2e/**", "node_modules/**"],
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
    },
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
  });
  ```

  `singleFork` keeps Postgres connections sane; tests use BEGIN/ROLLBACK so serialization is fine.

- [ ] **Step 4: Create `playwright.config.ts`**

  ```ts
  import { defineConfig, devices } from "@playwright/test";

  export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    use: {
      baseURL: "http://localhost:3000",
      trace: "retain-on-failure",
    },
    projects: [
      { name: "chromium", use: { ...devices["Desktop Chrome"] } },
      { name: "mobile", use: { ...devices["iPhone 13"] } },
    ],
    webServer: {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  });
  ```

- [ ] **Step 5: Create `tests/setup.ts`** (the test harness — used by every DB test)

  ```ts
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
  ```

- [ ] **Step 6: Verify the toolchain compiles**

  Run:

  ```bash
  pnpm typecheck && pnpm exec vitest run --reporter=verbose --run --passWithNoTests
  ```

  Expected: typecheck passes; Vitest reports `0 passed` (no tests yet).

- [ ] **Step 7: Commit**

  ```bash
  git add package.json pnpm-lock.yaml vitest.config.ts playwright.config.ts tests/setup.ts
  git commit -m "Add Vitest + Playwright + pg test harness"
  ```

---

## Task 2: Initialize local Supabase + project config

**Files:**

- Create: `supabase/config.toml` (auto-generated; we add seed paths)
- Create: `supabase/seed.sql` (empty placeholder for now)
- Modify: `.gitignore`

- [ ] **Step 1: Verify Docker is running**

  Run:

  ```bash
  docker info > /dev/null 2>&1 && echo OK || echo "Start Docker Desktop first"
  ```

  Expected: `OK`. (Supabase local stack runs in Docker.)

- [ ] **Step 2: Install the Supabase CLI**

  ```bash
  brew install supabase/tap/supabase
  supabase --version
  ```

  Expected: a version string (≥ `2.0.0`).

- [ ] **Step 3: Initialize Supabase in the repo**

  ```bash
  supabase init
  ```

  Expected: creates `supabase/config.toml` and `supabase/seed.sql`.

- [ ] **Step 4: Edit `supabase/config.toml`** to expose Clerk-aligned auth and a stable port

  Find the `[auth.third_party.clerk]` section (or add it if missing) and set:

  ```toml
  [auth.third_party.clerk]
  enabled = true
  domain = "<paste-your-clerk-frontend-api-domain-here-from-pre-flight-step-B>"
  ```

  Find `[api]` and confirm `port = 54321`. Find `[db]` and confirm `port = 54322`.

- [ ] **Step 5: Add the local Supabase data dir to `.gitignore`**

  Append to `.gitignore`:

  ```
  # supabase local stack
  /supabase/.branches
  /supabase/.temp
  ```

- [ ] **Step 6: Start Supabase locally**

  ```bash
  pnpm db:start
  ```

  Expected output includes lines like:

  ```
  API URL: http://127.0.0.1:54321
  DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
  Studio URL: http://127.0.0.1:54323
  ```

- [ ] **Step 7: Smoke-test the DB connection**

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "select version();"
  ```

  Expected: a `PostgreSQL 17.x ...` line.

- [ ] **Step 8: Commit**

  ```bash
  git add supabase/config.toml supabase/seed.sql .gitignore
  git commit -m "Initialize local Supabase stack with Clerk third-party auth"
  ```

---

## Task 3: Migration — `profiles` table + RLS, with tests

**Files:**

- Create: `supabase/migrations/20260510_001_profiles.sql`
- Create: `tests/factories.ts`
- Create: `tests/db/profiles.test.ts`

- [ ] **Step 1: Write the failing test first**

  Create `tests/factories.ts` with a single helper for now:

  ```ts
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
  ```

  Create `tests/db/profiles.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { asAnon, setJwtClaims, withTransaction } from "../setup";
  import { insertProfile } from "../factories";

  describe("profiles RLS", () => {
    it("authenticated user can read their own profile only", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const other = await insertProfile(c);

        await setJwtClaims(c, { sub: me.clerk_user_id });
        const { rows } = await c.query("select id from profiles");

        expect(rows.map((r) => r.id).sort()).toEqual([me.id]);
        expect(rows).not.toContainEqual(expect.objectContaining({ id: other.id }));
      });
    });

    it("anon role sees zero profiles", async () => {
      await withTransaction(async (c) => {
        await insertProfile(c);
        await asAnon(c);
        const { rows } = await c.query("select id from profiles");
        expect(rows).toHaveLength(0);
      });
    });

    it("user can update display_name on own row", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c, { display_name: "Old" });
        await setJwtClaims(c, { sub: me.clerk_user_id });
        await c.query(
          "update profiles set display_name = $1 where id = $2",
          ["New", me.id],
        );
        const { rows } = await c.query(
          "select display_name from profiles where id = $1",
          [me.id],
        );
        expect(rows[0].display_name).toBe("New");
      });
    });

    it("user cannot update is_admin on own row", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c, { is_admin: false });
        await setJwtClaims(c, { sub: me.clerk_user_id });
        await c.query("update profiles set is_admin = true where id = $1", [me.id]);
        const { rows } = await c.query(
          "select is_admin from profiles where id = $1",
          [me.id],
        );
        expect(rows[0].is_admin).toBe(false);
      });
    });
  });
  ```

- [ ] **Step 2: Run the failing test**

  ```bash
  pnpm test tests/db/profiles.test.ts
  ```

  Expected: tests fail with `relation "profiles" does not exist`.

- [ ] **Step 3: Write the migration**

  Create `supabase/migrations/20260510_001_profiles.sql`:

  ```sql
  -- Profiles table — one row per Clerk user. RLS enforces self-read/self-write.
  -- Admin reads via is_admin flag (set by app boot from ZOMAID_ADMIN_CLERK_USER_IDS).

  create extension if not exists pgcrypto;

  create table public.profiles (
    id            uuid primary key default gen_random_uuid(),
    clerk_user_id text not null unique,
    email         text not null,
    display_name  text not null default '',
    locale        text not null default 'en-SG',
    timezone      text not null default 'Asia/Singapore',
    is_admin      boolean not null default false,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );

  create index profiles_clerk_user_id_idx on public.profiles (clerk_user_id);

  alter table public.profiles enable row level security;

  -- Helper: returns the caller's profiles.id from their JWT sub.
  create or replace function public.current_profile_id() returns uuid
    language sql stable security invoker
    set search_path = public
    as $$
      select id from public.profiles
      where clerk_user_id = (auth.jwt() ->> 'sub');
    $$;

  -- Helper: returns true if caller is admin.
  create or replace function public.current_is_admin() returns boolean
    language sql stable security invoker
    set search_path = public
    as $$
      select coalesce(
        (select is_admin from public.profiles
         where clerk_user_id = (auth.jwt() ->> 'sub')),
        false
      );
    $$;

  -- Self-read.
  create policy profiles_self_read on public.profiles
    for select to authenticated
    using (clerk_user_id = (auth.jwt() ->> 'sub'));

  -- Admin-read (cross-tenant).
  create policy profiles_admin_read on public.profiles
    for select to authenticated
    using (public.current_is_admin());

  -- Self-update of safe columns. Trigger below blocks is_admin and immutable cols.
  create policy profiles_self_update on public.profiles
    for update to authenticated
    using (clerk_user_id = (auth.jwt() ->> 'sub'))
    with check (clerk_user_id = (auth.jwt() ->> 'sub'));

  create or replace function public.profiles_block_protected_columns()
    returns trigger language plpgsql as $$
    begin
      if new.id           is distinct from old.id           then raise exception 'id is immutable'; end if;
      if new.clerk_user_id is distinct from old.clerk_user_id then raise exception 'clerk_user_id is immutable'; end if;
      if new.email        is distinct from old.email        then new.email := old.email; end if;
      if new.is_admin     is distinct from old.is_admin     and not public.current_is_admin()
        then new.is_admin := old.is_admin;
      end if;
      new.updated_at := now();
      return new;
    end;
    $$;

  create trigger profiles_block_protected_columns
    before update on public.profiles
    for each row execute function public.profiles_block_protected_columns();

  -- Service role (used by webhooks + boot tasks) bypasses RLS entirely. No policy needed.

  -- Anon users have no policy => zero visibility. Confirmed by test.
  ```

- [ ] **Step 4: Apply the migration**

  Run:

  ```bash
  pnpm db:reset
  ```

  Expected: prints applied migration filenames including `20260510_001_profiles.sql`.

- [ ] **Step 5: Run the test again**

  ```bash
  pnpm test tests/db/profiles.test.ts
  ```

  Expected: 4 tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260510_001_profiles.sql tests/factories.ts tests/db/profiles.test.ts
  git commit -m "Add profiles table + RLS with self-read/self-update"
  ```

---

## Task 4: Modify Supabase clients to forward Clerk's session token

**Files:**

- Modify: `src/lib/supabase/client.ts`
- Modify: `src/lib/supabase/server.ts`
- Create: `src/lib/db/types.ts`

- [ ] **Step 1: Replace `src/lib/supabase/server.ts`**

  ```ts
  import { createServerClient } from "@supabase/ssr";
  import { auth } from "@clerk/nextjs/server";
  import { cookies } from "next/headers";
  import type { Database } from "@/lib/db/types";

  export async function createClient() {
    const { getToken } = await auth();
    const cookieStore = await cookies();

    return createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        accessToken: async () => (await getToken({ template: "supabase" })) ?? null,
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options),
              );
            } catch {
              // Server Component context; cookies cannot be written here.
            }
          },
        },
      },
    );
  }

  /** Service-role client. Bypasses RLS. Server-only; never expose anon callers to it. */
  export function createServiceClient() {
    return createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        cookies: { getAll: () => [], setAll: () => {} },
      },
    );
  }
  ```

- [ ] **Step 2: Replace `src/lib/supabase/client.ts`**

  ```ts
  "use client";

  import { createBrowserClient } from "@supabase/ssr";
  import { useAuth } from "@clerk/nextjs";
  import { useMemo } from "react";
  import type { Database } from "@/lib/db/types";

  export function useSupabaseClient() {
    const { getToken } = useAuth();
    return useMemo(
      () =>
        createBrowserClient<Database>(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            accessToken: async () =>
              (await getToken({ template: "supabase" })) ?? null,
          },
        ),
      [getToken],
    );
  }
  ```

- [ ] **Step 3: Create the hand-written DB types file**

  We'll grow this as new tables ship. Create `src/lib/db/types.ts`:

  ```ts
  // Hand-maintained Supabase types. Regenerate with `supabase gen types typescript`
  // once the schema stabilizes; for now we curate exactly what we use.

  export type Role = "owner" | "family_member" | "maid";
  export type Privilege = "full" | "meal_modify" | "view_only";
  export type MembershipStatus = "active" | "pending" | "removed";
  export type IntendedRole = Role;

  export type Database = {
    public: {
      Tables: {
        profiles: {
          Row: {
            id: string;
            clerk_user_id: string;
            email: string;
            display_name: string;
            locale: string;
            timezone: string;
            is_admin: boolean;
            created_at: string;
            updated_at: string;
          };
          Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
            clerk_user_id: string;
            email: string;
          };
          Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        };
        // households, household_memberships, invites — added in later tasks.
      };
      Functions: {
        // redeem_invite — added in Task 8.
      };
    };
  };
  ```

- [ ] **Step 4: Verify it typechecks**

  ```bash
  pnpm typecheck
  ```

  Expected: passes.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/supabase/client.ts src/lib/supabase/server.ts src/lib/db/types.ts
  git commit -m "Forward Clerk JWT to Supabase via accessToken callback"
  ```

---

## Task 5: Clerk webhook → profiles upsert + `getCurrentProfile()` helper

**Files:**

- Create: `src/app/api/webhooks/clerk/route.ts`
- Create: `src/lib/auth/current-profile.ts`
- Modify: `package.json` (move `svix` from devDeps to deps)

- [ ] **Step 1: Move `svix` to runtime deps**

  ```bash
  pnpm remove -D svix && pnpm add svix
  ```

- [ ] **Step 2: Write the webhook route**

  Create `src/app/api/webhooks/clerk/route.ts`:

  ```ts
  import { Webhook } from "svix";
  import { headers } from "next/headers";
  import { createServiceClient } from "@/lib/supabase/server";
  import type { WebhookEvent } from "@clerk/nextjs/server";

  export async function POST(req: Request) {
    const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    if (!secret) return new Response("misconfigured", { status: 500 });

    const h = await headers();
    const svixId = h.get("svix-id");
    const svixTimestamp = h.get("svix-timestamp");
    const svixSignature = h.get("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response("missing signature headers", { status: 400 });
    }

    const body = await req.text();
    let evt: WebhookEvent;
    try {
      evt = new Webhook(secret).verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as WebhookEvent;
    } catch {
      return new Response("invalid signature", { status: 400 });
    }

    const supabase = createServiceClient();

    if (evt.type === "user.created" || evt.type === "user.updated") {
      const u = evt.data;
      const email =
        u.email_addresses.find((e) => e.id === u.primary_email_address_id)
          ?.email_address ??
        u.email_addresses[0]?.email_address ??
        "";
      const display = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();

      const { error } = await supabase.from("profiles").upsert(
        {
          clerk_user_id: u.id,
          email,
          display_name: display || email.split("@")[0] || "User",
        },
        { onConflict: "clerk_user_id" },
      );
      if (error) return new Response(error.message, { status: 500 });
    }

    if (evt.type === "user.deleted" && evt.data.id) {
      // Hard-delete the profile; cascading membership cleanup is out of scope here.
      // RLS-protected related rows will become orphans only if cascade is missing —
      // we'll add ON DELETE CASCADE in later migrations.
      const { error } = await supabase
        .from("profiles")
        .delete()
        .eq("clerk_user_id", evt.data.id);
      if (error) return new Response(error.message, { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }
  ```

- [ ] **Step 3: Write the lazy-upsert helper**

  Create `src/lib/auth/current-profile.ts`:

  ```ts
  import "server-only";
  import { auth, currentUser } from "@clerk/nextjs/server";
  import { createServiceClient } from "@/lib/supabase/server";
  import type { Database } from "@/lib/db/types";

  export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

  /**
   * Returns the caller's profile row, lazily upserting one from Clerk if missing
   * (backstop for delayed/lost user.created webhooks).
   * Throws when caller is not signed in.
   */
  export async function getCurrentProfile(): Promise<Profile> {
    const { userId } = await auth();
    if (!userId) throw new Error("not authenticated");

    const svc = createServiceClient();
    const existing = await svc
      .from("profiles")
      .select("*")
      .eq("clerk_user_id", userId)
      .maybeSingle();
    if (existing.data) return existing.data;

    const u = await currentUser();
    const email =
      u?.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)
        ?.emailAddress ??
      u?.emailAddresses[0]?.emailAddress ??
      "";
    const display = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();

    const inserted = await svc
      .from("profiles")
      .insert({
        clerk_user_id: userId,
        email,
        display_name: display || email.split("@")[0] || "User",
      })
      .select("*")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    return inserted.data;
  }
  ```

- [ ] **Step 4: Verify the webhook route typechecks**

  ```bash
  pnpm typecheck
  ```

  Expected: passes.

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/api/webhooks/clerk/route.ts src/lib/auth/current-profile.ts package.json pnpm-lock.yaml
  git commit -m "Sync Clerk users to profiles via webhook + lazy upsert backstop"
  ```

---

## Task 6: Migration — `households` table + RLS

**Files:**

- Create: `supabase/migrations/20260510_002_households.sql`
- Create: `tests/db/households.test.ts`
- Modify: `tests/factories.ts`

- [ ] **Step 1: Extend factories with `insertHousehold`**

  Append to `tests/factories.ts`:

  ```ts
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
  ```

- [ ] **Step 2: Write failing tests**

  Create `tests/db/households.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertProfile } from "../factories";

  describe("households RLS", () => {
    it("non-member cannot read a household", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const stranger = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });

        await setJwtClaims(c, { sub: stranger.clerk_user_id });
        const { rows } = await c.query("select id from households where id = $1", [h.id]);
        expect(rows).toHaveLength(0);
      });
    });

    it("creator who has no membership row cannot read household either", async () => {
      // Member-read policy requires an active household_memberships row, which
      // households-only insertion does not create. Until Task 7's memberships
      // migration runs, this test confirms the policy is strict.
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await setJwtClaims(c, { sub: me.clerk_user_id });
        const { rows } = await c.query("select id from households where id = $1", [h.id]);
        expect(rows).toHaveLength(0);
      });
    });
  });
  ```

- [ ] **Step 3: Run — see them fail**

  ```bash
  pnpm test tests/db/households.test.ts
  ```

  Expected: failure with `relation "households" does not exist`.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260510_002_households.sql`:

  ```sql
  create table public.households (
    id                       uuid primary key default gen_random_uuid(),
    name                     text not null,
    address_line             text,
    postal_code              text,
    created_by_profile_id    uuid not null references public.profiles(id) on delete restrict,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
  );

  create index households_created_by_idx on public.households (created_by_profile_id);

  alter table public.households enable row level security;

  -- INSERT only here. READ/UPDATE policies depend on household_memberships and
  -- are added in migration 003 (after that table exists). With RLS enabled and
  -- no SELECT policy, all reads are denied — exactly what tests/db/households.test.ts
  -- asserts.
  create policy households_creator_insert on public.households
    for insert to authenticated
    with check (created_by_profile_id = public.current_profile_id());
  ```

- [ ] **Step 5: Apply and rerun the test**

  ```bash
  pnpm db:reset && pnpm test tests/db/households.test.ts
  ```

  Expected: both tests pass — RLS is enabled with no SELECT policy, so all reads return zero rows for any authenticated caller.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260510_002_households.sql tests/db/households.test.ts tests/factories.ts
  git commit -m "Add households table + member-read / owner-update RLS"
  ```

---

## Task 7: Migration — `household_memberships` table + RLS, with tests

**Files:**

- Create: `supabase/migrations/20260510_003_household_memberships.sql`
- Create: `tests/db/memberships.test.ts`
- Modify: `tests/factories.ts`
- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Extend factories**

  Append to `tests/factories.ts`:

  ```ts
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
  ```

- [ ] **Step 2: Write failing tests**

  Create `tests/db/memberships.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";

  describe("household_memberships invariants & RLS", () => {
    it("rejects two active maids in one household", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const maid1 = await insertProfile(c);
        const maid2 = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: maid1.id, role: "maid" });
        await expect(
          insertMembership(c, { household_id: h.id, profile_id: maid2.id, role: "maid" }),
        ).rejects.toThrow();
      });
    });

    it("rejects two active owners in one household", async () => {
      await withTransaction(async (c) => {
        const o1 = await insertProfile(c);
        const o2 = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: o1.id });
        await insertMembership(c, { household_id: h.id, profile_id: o1.id, role: "owner" });
        await expect(
          insertMembership(c, { household_id: h.id, profile_id: o2.id, role: "owner" }),
        ).rejects.toThrow();
      });
    });

    it("allows multiple family members in one household", async () => {
      await withTransaction(async (c) => {
        const o = await insertProfile(c);
        const f1 = await insertProfile(c);
        const f2 = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: o.id });
        await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
        await insertMembership(c, { household_id: h.id, profile_id: f1.id, role: "family_member" });
        await insertMembership(c, { household_id: h.id, profile_id: f2.id, role: "family_member" });
      });
    });

    it("members of household see each other; non-members see nothing", async () => {
      await withTransaction(async (c) => {
        const o = await insertProfile(c);
        const m = await insertProfile(c);
        const stranger = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: o.id });
        await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
        await insertMembership(c, { household_id: h.id, profile_id: m.id, role: "maid" });

        await setJwtClaims(c, { sub: o.clerk_user_id });
        const seen = await c.query(
          "select profile_id from household_memberships where household_id = $1",
          [h.id],
        );
        expect(seen.rows.map((r) => r.profile_id).sort()).toEqual([o.id, m.id].sort());

        await setJwtClaims(c, { sub: stranger.clerk_user_id });
        const blind = await c.query(
          "select profile_id from household_memberships where household_id = $1",
          [h.id],
        );
        expect(blind.rows).toHaveLength(0);
      });
    });

    it("active owner can update any membership in their household", async () => {
      await withTransaction(async (c) => {
        const o = await insertProfile(c);
        const f = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: o.id });
        await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
        const fm = await insertMembership(c, {
          household_id: h.id,
          profile_id: f.id,
          role: "family_member",
          privilege: "view_only",
        });
        await setJwtClaims(c, { sub: o.clerk_user_id });
        await c.query(
          "update household_memberships set privilege = 'meal_modify' where id = $1",
          [fm.id],
        );
        const { rows } = await c.query(
          "select privilege from household_memberships where id = $1",
          [fm.id],
        );
        expect(rows[0].privilege).toBe("meal_modify");
      });
    });

    it("member can self-leave (status -> removed)", async () => {
      await withTransaction(async (c) => {
        const o = await insertProfile(c);
        const f = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: o.id });
        await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
        const fm = await insertMembership(c, {
          household_id: h.id,
          profile_id: f.id,
          role: "family_member",
        });
        await setJwtClaims(c, { sub: f.clerk_user_id });
        await c.query(
          "update household_memberships set status = 'removed', removed_at = now() where id = $1",
          [fm.id],
        );
        const { rows } = await c.query(
          "select status from household_memberships where id = $1",
          [fm.id],
        );
        expect(rows[0].status).toBe("removed");
      });
    });

    it("non-owner cannot remove someone else", async () => {
      await withTransaction(async (c) => {
        const o = await insertProfile(c);
        const f = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: o.id });
        await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
        const fm = await insertMembership(c, {
          household_id: h.id,
          profile_id: f.id,
          role: "family_member",
        });
        // f tries to remove the owner
        await setJwtClaims(c, { sub: f.clerk_user_id });
        await c.query(
          "update household_memberships set status = 'removed' where role = 'owner'",
        );
        const { rows } = await c.query(
          "select status from household_memberships where role = 'owner'",
        );
        expect(rows[0].status).toBe("active");
      });
    });
  });
  ```

- [ ] **Step 3: Run them — they fail**

  ```bash
  pnpm test tests/db/memberships.test.ts
  ```

  Expected: `relation "household_memberships" does not exist`.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260510_003_household_memberships.sql`:

  ```sql
  create type public.household_role     as enum ('owner', 'family_member', 'maid');
  create type public.household_privilege as enum ('full', 'meal_modify', 'view_only');
  create type public.membership_status   as enum ('active', 'pending', 'removed');

  create table public.household_memberships (
    id            uuid primary key default gen_random_uuid(),
    household_id  uuid not null references public.households(id)        on delete cascade,
    profile_id    uuid not null references public.profiles(id)          on delete cascade,
    role          public.household_role     not null,
    privilege     public.household_privilege not null default 'full',
    status        public.membership_status   not null default 'active',
    joined_at     timestamptz not null default now(),
    removed_at    timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
  );

  -- One active membership per (household, profile)
  create unique index hm_unique_active_pair
    on public.household_memberships (household_id, profile_id)
    where status <> 'removed';

  -- At most one active maid per household
  create unique index hm_unique_active_maid
    on public.household_memberships (household_id)
    where role = 'maid' and status = 'active';

  -- At most one active owner per household
  create unique index hm_unique_active_owner
    on public.household_memberships (household_id)
    where role = 'owner' and status = 'active';

  alter table public.household_memberships enable row level security;

  -- Members of the same household can read each other
  create policy hm_household_read on public.household_memberships
    for select to authenticated
    using (
      exists (
        select 1 from public.household_memberships me
        where me.household_id = household_memberships.household_id
          and me.profile_id  = public.current_profile_id()
          and me.status      = 'active'
      )
    );

  -- Active owner can manage all memberships in their household
  create policy hm_owner_update on public.household_memberships
    for update to authenticated
    using (
      exists (
        select 1 from public.household_memberships me
        where me.household_id = household_memberships.household_id
          and me.profile_id  = public.current_profile_id()
          and me.role        = 'owner'
          and me.status      = 'active'
      )
    )
    with check (
      exists (
        select 1 from public.household_memberships me
        where me.household_id = household_memberships.household_id
          and me.profile_id  = public.current_profile_id()
          and me.role        = 'owner'
          and me.status      = 'active'
      )
    );

  -- A user can self-leave: update own row to status='removed'
  create policy hm_self_leave on public.household_memberships
    for update to authenticated
    using (profile_id = public.current_profile_id())
    with check (
      profile_id = public.current_profile_id()
      and status = 'removed'
    );

  -- Owner can also insert new memberships in their household (used by accept-invite
  -- only via the SECURITY DEFINER function in Task 8; but we still expose this so
  -- service-side helpers don't all need service role).
  create policy hm_owner_insert on public.household_memberships
    for insert to authenticated
    with check (
      exists (
        select 1 from public.household_memberships me
        where me.household_id = household_memberships.household_id
          and me.profile_id  = public.current_profile_id()
          and me.role        = 'owner'
          and me.status      = 'active'
      )
    );

  -- Touch updated_at on every UPDATE
  create or replace function public.touch_updated_at()
    returns trigger language plpgsql as $$
    begin new.updated_at := now(); return new; end;
    $$;
  create trigger hm_touch_updated_at before update on public.household_memberships
    for each row execute function public.touch_updated_at();

  -- ----- Households read/update policies (now that memberships exists) -----

  create policy households_member_read on public.households
    for select to authenticated
    using (
      exists (
        select 1 from public.household_memberships m
        where m.household_id = households.id
          and m.profile_id  = public.current_profile_id()
          and m.status      = 'active'
      )
    );

  create policy households_owner_update on public.households
    for update to authenticated
    using (
      exists (
        select 1 from public.household_memberships m
        where m.household_id = households.id
          and m.profile_id  = public.current_profile_id()
          and m.role        = 'owner'
          and m.status      = 'active'
      )
    )
    with check (true);
  ```

- [ ] **Step 5: Apply and rerun all DB tests**

  ```bash
  pnpm db:reset && pnpm test tests/db/
  ```

  Expected: all tests pass (profiles + households + memberships).

- [ ] **Step 6: Extend `src/lib/db/types.ts`**

  Replace the placeholder Tables block to add the new tables:

  ```ts
  // Inside Database["public"]["Tables"], add:

  households: {
    Row: {
      id: string;
      name: string;
      address_line: string | null;
      postal_code: string | null;
      created_by_profile_id: string;
      created_at: string;
      updated_at: string;
    };
    Insert: { name: string; created_by_profile_id: string; address_line?: string | null; postal_code?: string | null };
    Update: Partial<Database["public"]["Tables"]["households"]["Row"]>;
  };

  household_memberships: {
    Row: {
      id: string;
      household_id: string;
      profile_id: string;
      role: Role;
      privilege: Privilege;
      status: MembershipStatus;
      joined_at: string;
      removed_at: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      household_id: string;
      profile_id: string;
      role: Role;
      privilege?: Privilege;
      status?: MembershipStatus;
    };
    Update: Partial<Database["public"]["Tables"]["household_memberships"]["Row"]>;
  };
  ```

  Then run `pnpm typecheck` — expected: passes.

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/migrations/20260510_003_household_memberships.sql \
          tests/db/memberships.test.ts tests/factories.ts src/lib/db/types.ts
  git commit -m "Add household_memberships table, unique invariants, and RLS"
  ```

---

## Task 8: Migration — `invites` table + `redeem_invite` RPC, with tests

**Files:**

- Create: `supabase/migrations/20260510_004_invites.sql`
- Create: `supabase/migrations/20260510_005_redeem_invite_rpc.sql`
- Create: `tests/db/invites.test.ts`
- Modify: `tests/factories.ts`
- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Extend factories**

  Append to `tests/factories.ts`:

  ```ts
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
    await client.query(
      `insert into invites
        (id, household_id, invited_by_profile_id, intended_role, intended_privilege,
         code, token, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7, ${overrides.expires_at ? "$8" : "now() + interval '7 days'"})`,
      overrides.expires_at
        ? [row.id, row.household_id, row.invited_by_profile_id, row.intended_role,
           row.intended_privilege, row.code, row.token, overrides.expires_at]
        : [row.id, row.household_id, row.invited_by_profile_id, row.intended_role,
           row.intended_privilege, row.code, row.token],
    );
    return row;
  }
  ```

- [ ] **Step 2: Write failing tests**

  Create `tests/db/invites.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import {
    insertHousehold, insertInvite, insertMembership, insertProfile,
  } from "../factories";

  describe("invites + redeem_invite RPC", () => {
    it("redeem creates an active membership and consumes the invite", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const family = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
        const inv = await insertInvite(c, {
          household_id: h.id,
          invited_by_profile_id: owner.id,
          intended_role: "family_member",
          intended_privilege: "meal_modify",
        });

        await setJwtClaims(c, { sub: family.clerk_user_id });
        // Ensure family has a profile row first (lazy upsert is in app code; here tests
        // create the row via insertProfile already)
        const { rows } = await c.query("select * from redeem_invite($1)", [inv.token]);
        expect(rows).toHaveLength(1);
        expect(rows[0].profile_id).toBe(family.id);
        expect(rows[0].role).toBe("family_member");
        expect(rows[0].privilege).toBe("meal_modify");
        expect(rows[0].status).toBe("active");

        const after = await c.query("select consumed_at from invites where id = $1", [inv.id]);
        expect(after.rows[0].consumed_at).not.toBeNull();
      });
    });

    it("redeeming the same token twice fails on the second call", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const family = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
        const inv = await insertInvite(c, {
          household_id: h.id,
          invited_by_profile_id: owner.id,
          intended_role: "family_member",
          intended_privilege: "meal_modify",
        });
        await setJwtClaims(c, { sub: family.clerk_user_id });
        await c.query("select * from redeem_invite($1)", [inv.token]);

        await expect(
          c.query("select * from redeem_invite($1)", [inv.token]),
        ).rejects.toThrow(/already consumed/);
      });
    });

    it("expired invite cannot be redeemed", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const family = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
        const inv = await insertInvite(c, {
          household_id: h.id,
          invited_by_profile_id: owner.id,
          intended_role: "family_member",
          expires_at: "now() - interval '1 minute'",
        });
        await setJwtClaims(c, { sub: family.clerk_user_id });
        await expect(
          c.query("select * from redeem_invite($1)", [inv.token]),
        ).rejects.toThrow(/expired/);
      });
    });

    it("redeeming a maid invite when an active maid already exists fails", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const maid1 = await insertProfile(c);
        const maid2 = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
        await insertMembership(c, { household_id: h.id, profile_id: maid1.id, role: "maid" });
        const inv = await insertInvite(c, {
          household_id: h.id,
          invited_by_profile_id: owner.id,
          intended_role: "maid",
        });
        await setJwtClaims(c, { sub: maid2.clerk_user_id });
        await expect(
          c.query("select * from redeem_invite($1)", [inv.token]),
        ).rejects.toThrow(/already has an active maid/);
      });
    });

    it("invites are visible to active owner of the household", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const stranger = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
        await insertInvite(c, {
          household_id: h.id,
          invited_by_profile_id: owner.id,
          intended_role: "family_member",
        });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        const visible = await c.query("select id from invites");
        expect(visible.rows).toHaveLength(1);

        await setJwtClaims(c, { sub: stranger.clerk_user_id });
        const blind = await c.query("select id from invites");
        expect(blind.rows).toHaveLength(0);
      });
    });
  });
  ```

- [ ] **Step 3: Run — see them fail**

  ```bash
  pnpm test tests/db/invites.test.ts
  ```

  Expected: `relation "invites" does not exist`.

- [ ] **Step 4: Write the invites migration**

  Create `supabase/migrations/20260510_004_invites.sql`:

  ```sql
  create table public.invites (
    id                       uuid primary key default gen_random_uuid(),
    household_id             uuid not null references public.households(id) on delete cascade,
    invited_by_profile_id    uuid not null references public.profiles(id)   on delete restrict,
    intended_role            public.household_role      not null,
    intended_privilege       public.household_privilege,
    code                     text not null,
    token                    text not null unique,
    expires_at               timestamptz not null default (now() + interval '7 days'),
    consumed_at              timestamptz,
    consumed_by_profile_id   uuid references public.profiles(id) on delete set null,
    created_at               timestamptz not null default now()
  );

  create unique index invites_active_code_idx
    on public.invites (code)
    where consumed_at is null and expires_at > now();

  create index invites_household_idx on public.invites (household_id);

  alter table public.invites enable row level security;

  -- Read: caller is active owner OR active maid of the household
  create policy invites_household_eligible_read on public.invites
    for select to authenticated
    using (
      exists (
        select 1 from public.household_memberships m
        where m.household_id = invites.household_id
          and m.profile_id  = public.current_profile_id()
          and m.role in ('owner', 'maid')
          and m.status = 'active'
      )
    );

  -- Insert: same predicate (the application restricts further per spec §5.3)
  create policy invites_household_eligible_insert on public.invites
    for insert to authenticated
    with check (
      invited_by_profile_id = public.current_profile_id()
      and exists (
        select 1 from public.household_memberships m
        where m.household_id = invites.household_id
          and m.profile_id  = public.current_profile_id()
          and m.role in ('owner', 'maid')
          and m.status = 'active'
      )
    );

  -- Update (revoke): inviter or any active owner
  create policy invites_revoke_update on public.invites
    for update to authenticated
    using (
      invited_by_profile_id = public.current_profile_id()
      or exists (
        select 1 from public.household_memberships m
        where m.household_id = invites.household_id
          and m.profile_id  = public.current_profile_id()
          and m.role        = 'owner'
          and m.status      = 'active'
      )
    )
    with check (true);
  ```

- [ ] **Step 5: Write the `redeem_invite` migration**

  Create `supabase/migrations/20260510_005_redeem_invite_rpc.sql`:

  ```sql
  -- redeem_invite(token) — only path to bypass RLS for invite consumption.
  -- SECURITY DEFINER + locked search_path. Caller must be an authenticated user
  -- with an existing profiles row (lazy-upserted by the app helper).

  create or replace function public.redeem_invite(p_token text)
    returns public.household_memberships
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $$
  declare
    v_caller_clerk text := auth.jwt() ->> 'sub';
    v_profile      public.profiles%rowtype;
    v_invite       public.invites%rowtype;
    v_membership   public.household_memberships%rowtype;
  begin
    if v_caller_clerk is null then
      raise exception 'not authenticated' using errcode = '28000';
    end if;

    select * into v_profile from public.profiles where clerk_user_id = v_caller_clerk;
    if not found then
      raise exception 'profile missing — sign in again to provision' using errcode = 'P0001';
    end if;

    select * into v_invite from public.invites where token = p_token for update;
    if not found then
      raise exception 'invite not found' using errcode = 'P0002';
    end if;
    if v_invite.consumed_at is not null then
      raise exception 'invite already consumed' using errcode = 'P0003';
    end if;
    if v_invite.expires_at <= now() then
      raise exception 'invite expired' using errcode = 'P0004';
    end if;

    -- Capacity invariants
    if v_invite.intended_role = 'maid' and exists (
      select 1 from public.household_memberships
      where household_id = v_invite.household_id
        and role = 'maid' and status = 'active'
    ) then
      raise exception 'household already has an active maid' using errcode = 'P0005';
    end if;

    if v_invite.intended_role = 'owner' and exists (
      select 1 from public.household_memberships
      where household_id = v_invite.household_id
        and role = 'owner' and status = 'active'
    ) then
      raise exception 'household already has an active owner' using errcode = 'P0006';
    end if;

    -- The (household, profile) active-pair uniqueness is enforced by the partial index
    insert into public.household_memberships
      (household_id, profile_id, role, privilege, status)
    values
      (v_invite.household_id,
       v_profile.id,
       v_invite.intended_role,
       coalesce(v_invite.intended_privilege, 'full'),
       'active')
    returning * into v_membership;

    update public.invites
       set consumed_at = now(),
           consumed_by_profile_id = v_profile.id
     where id = v_invite.id;

    return v_membership;
  end;
  $$;

  grant execute on function public.redeem_invite(text) to authenticated;
  ```

- [ ] **Step 6: Apply and rerun all DB tests**

  ```bash
  pnpm db:reset && pnpm test tests/db/
  ```

  Expected: all DB tests pass.

- [ ] **Step 7: Extend `src/lib/db/types.ts`**

  Inside `Database["public"]["Tables"]`, add:

  ```ts
  invites: {
    Row: {
      id: string;
      household_id: string;
      invited_by_profile_id: string;
      intended_role: Role;
      intended_privilege: Privilege | null;
      code: string;
      token: string;
      expires_at: string;
      consumed_at: string | null;
      consumed_by_profile_id: string | null;
      created_at: string;
    };
    Insert: {
      household_id: string;
      invited_by_profile_id: string;
      intended_role: Role;
      intended_privilege?: Privilege | null;
      code: string;
      token: string;
      expires_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["invites"]["Row"]>;
  };
  ```

  And inside `Database["public"]["Functions"]`, add:

  ```ts
  redeem_invite: {
    Args: { p_token: string };
    Returns: Database["public"]["Tables"]["household_memberships"]["Row"];
  };
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add supabase/migrations/20260510_004_invites.sql \
          supabase/migrations/20260510_005_redeem_invite_rpc.sql \
          tests/db/invites.test.ts tests/factories.ts src/lib/db/types.ts
  git commit -m "Add invites table + redeem_invite SECURITY DEFINER RPC"
  ```

---

## Task 9: App auth helpers (`getCurrentHousehold`, `requireRole`, `requirePrivilege`)

**Files:**

- Create: `src/lib/auth/current-household.ts`
- Create: `src/lib/auth/require.ts`
- Create: `tests/auth/helpers.test.ts`

- [ ] **Step 1: Write `current-household.ts`**

  ```ts
  import "server-only";
  import { getCurrentProfile } from "./current-profile";
  import { createClient } from "@/lib/supabase/server";
  import type { Database } from "@/lib/db/types";

  export type Membership = Database["public"]["Tables"]["household_memberships"]["Row"];
  export type Household  = Database["public"]["Tables"]["households"]["Row"];

  export type CurrentHousehold = {
    profile: Awaited<ReturnType<typeof getCurrentProfile>>;
    household: Household;
    membership: Membership;
  };

  export async function getCurrentHousehold(): Promise<CurrentHousehold | null> {
    const profile = await getCurrentProfile();
    const supabase = await createClient();

    const memberships = await supabase
      .from("household_memberships")
      .select("*, household:households(*)")
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (memberships.error) throw new Error(memberships.error.message);
    const row = memberships.data?.[0];
    if (!row) return null;

    const { household, ...membership } = row as typeof row & { household: Household };
    return { profile, household, membership: membership as Membership };
  }
  ```

- [ ] **Step 2: Write `require.ts`**

  ```ts
  import "server-only";
  import { redirect } from "next/navigation";
  import {
    getCurrentHousehold,
    type CurrentHousehold,
  } from "./current-household";
  import type { Privilege, Role } from "@/lib/db/types";

  export async function requireHousehold(): Promise<CurrentHousehold> {
    const ctx = await getCurrentHousehold();
    if (!ctx) redirect("/onboarding");
    return ctx;
  }

  export async function requireRole(role: Role): Promise<CurrentHousehold> {
    const ctx = await requireHousehold();
    if (ctx.membership.role !== role) redirect("/dashboard");
    return ctx;
  }

  export async function requirePrivilege(min: Privilege): Promise<CurrentHousehold> {
    const ctx = await requireHousehold();
    const order: Record<Privilege, number> = { view_only: 0, meal_modify: 1, full: 2 };
    if (order[ctx.membership.privilege] < order[min]) redirect("/dashboard");
    return ctx;
  }
  ```

- [ ] **Step 3: Write a small helper test (priv-order is the meaningful logic)**

  Create `tests/auth/helpers.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  // Pure-function copy of the order map — keep in sync with require.ts
  const order = { view_only: 0, meal_modify: 1, full: 2 } as const;

  describe("privilege ordering", () => {
    it("full satisfies any minimum", () => {
      for (const min of ["view_only", "meal_modify", "full"] as const) {
        expect(order["full"] >= order[min]).toBe(true);
      }
    });
    it("view_only does not satisfy meal_modify", () => {
      expect(order["view_only"] >= order["meal_modify"]).toBe(false);
    });
  });
  ```

- [ ] **Step 4: Verify**

  ```bash
  pnpm typecheck && pnpm test tests/auth/
  ```

  Expected: passes.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/auth/current-household.ts src/lib/auth/require.ts tests/auth/helpers.test.ts
  git commit -m "Add current-household, require helpers, and privilege ordering test"
  ```

---

## Task 10: Onboarding server actions — `createHouseholdAsOwner`, `createHouseholdAsMaid`

**Files:**

- Create: `src/app/onboarding/actions.ts`
- Create: `tests/actions/onboarding.test.ts`

- [ ] **Step 1: Write the server actions**

  ```ts
  "use server";

  import { z } from "zod";
  import { revalidatePath } from "next/cache";
  import { redirect } from "next/navigation";
  import { randomBytes } from "node:crypto";
  import { getCurrentProfile } from "@/lib/auth/current-profile";
  import { createServiceClient } from "@/lib/supabase/server";

  const ownerSchema = z.object({
    name: z.string().min(1).max(100),
    addressLine: z.string().max(200).optional(),
    postalCode: z.string().max(20).optional(),
  });

  const maidSchema = z.object({
    ownerName: z.string().min(1).max(100),
    ownerEmail: z.email().max(200),
  });

  export async function createHouseholdAsOwner(input: unknown) {
    const data = ownerSchema.parse(input);
    const profile = await getCurrentProfile();
    const svc = createServiceClient();

    // Reject if user already has any active membership (one household per user, v1)
    const existing = await svc
      .from("household_memberships")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .limit(1);
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.length) redirect("/dashboard");

    const h = await svc
      .from("households")
      .insert({
        name: data.name,
        address_line: data.addressLine ?? null,
        postal_code: data.postalCode ?? null,
        created_by_profile_id: profile.id,
      })
      .select("id")
      .single();
    if (h.error) throw new Error(h.error.message);

    const m = await svc.from("household_memberships").insert({
      household_id: h.data.id,
      profile_id: profile.id,
      role: "owner",
      privilege: "full",
      status: "active",
    });
    if (m.error) throw new Error(m.error.message);

    revalidatePath("/dashboard");
    redirect("/dashboard");
  }

  export async function createHouseholdAsMaid(input: unknown) {
    const data = maidSchema.parse(input);
    const profile = await getCurrentProfile();
    const svc = createServiceClient();

    const existing = await svc
      .from("household_memberships")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .limit(1);
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.length) redirect("/dashboard");

    const householdName = `${data.ownerName.trim()}'s household`;

    const h = await svc
      .from("households")
      .insert({
        name: householdName,
        created_by_profile_id: profile.id,
      })
      .select("id")
      .single();
    if (h.error) throw new Error(h.error.message);

    const m = await svc.from("household_memberships").insert({
      household_id: h.data.id,
      profile_id: profile.id,
      role: "maid",
      privilege: "full",
      status: "active",
    });
    if (m.error) throw new Error(m.error.message);

    // Mint pending owner invite
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const token = randomBytes(32).toString("base64url");
    const inv = await svc.from("invites").insert({
      household_id: h.data.id,
      invited_by_profile_id: profile.id,
      intended_role: "owner",
      intended_privilege: "full",
      code,
      token,
    });
    if (inv.error) throw new Error(inv.error.message);

    // Surface invite via query string (one-shot UX; user can also see it in /household/settings)
    revalidatePath("/dashboard");
    redirect(`/dashboard?ownerInvite=${encodeURIComponent(token)}`);
  }
  ```

- [ ] **Step 2: Write tests**

  Create `tests/actions/onboarding.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { withTransaction } from "../setup";
  import { insertProfile, insertHousehold, insertMembership } from "../factories";

  describe("onboarding action invariants (DB-level)", () => {
    it("rejects creating a household for a user who already has an active membership", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });

        // Simulate: trying to insert a second active membership for the same profile
        await expect(
          insertMembership(c, {
            household_id: h.id,
            profile_id: owner.id,
            role: "family_member",
          }),
        ).rejects.toThrow();
      });
    });

    it("maid invariant blocks two active maids in same household", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const m1 = await insertProfile(c);
        const m2 = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: m1.id, role: "maid" });
        await expect(
          insertMembership(c, { household_id: h.id, profile_id: m2.id, role: "maid" }),
        ).rejects.toThrow();
      });
    });
  });
  ```

  These confirm the DB enforces what the server actions promise; testing the actions themselves with mocked Clerk/Next is brittle and yields little value at this layer — E2E (Task 17) covers them end-to-end.

- [ ] **Step 3: Verify**

  ```bash
  pnpm typecheck && pnpm test tests/
  ```

  Expected: passes.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/onboarding/actions.ts tests/actions/onboarding.test.ts
  git commit -m "Add onboarding server actions + DB invariant tests"
  ```

---

## Task 11: Invite + membership server actions

**Files:**

- Create: `src/app/household/settings/actions.ts`
- Create: `tests/actions/invites.test.ts`
- Create: `tests/actions/memberships.test.ts`

- [ ] **Step 1: Write `src/app/household/settings/actions.ts`**

  ```ts
  "use server";

  import { z } from "zod";
  import { revalidatePath } from "next/cache";
  import { redirect } from "next/navigation";
  import { randomBytes } from "node:crypto";
  import { getCurrentHousehold } from "@/lib/auth/current-household";
  import { createServiceClient } from "@/lib/supabase/server";
  import type { Privilege, Role } from "@/lib/db/types";

  const createInviteSchema = z.object({
    role: z.enum(["owner", "family_member", "maid"]),
    privilege: z.enum(["full", "meal_modify", "view_only"]).optional(),
  });

  export async function createInvite(input: unknown) {
    const data = createInviteSchema.parse(input);
    const ctx = await getCurrentHousehold();
    if (!ctx) throw new Error("no active household");
    const { household, membership, profile } = ctx;

    // Spec §5.3 invariants
    if (data.role === "owner" && membership.role !== "maid") {
      throw new Error("only the maid can invite the owner");
    }
    if (data.role !== "owner" && membership.role !== "owner") {
      throw new Error("only an owner can invite this role");
    }

    const svc = createServiceClient();

    if (data.role === "maid") {
      const has = await svc
        .from("household_memberships")
        .select("id")
        .eq("household_id", household.id)
        .eq("role", "maid")
        .eq("status", "active")
        .limit(1);
      if (has.error) throw new Error(has.error.message);
      if (has.data?.length) throw new Error("household already has an active maid");
    }
    if (data.role === "owner") {
      const has = await svc
        .from("household_memberships")
        .select("id")
        .eq("household_id", household.id)
        .eq("role", "owner")
        .eq("status", "active")
        .limit(1);
      if (has.error) throw new Error(has.error.message);
      if (has.data?.length) throw new Error("household already has an active owner");
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const token = randomBytes(32).toString("base64url");

    const inv = await svc
      .from("invites")
      .insert({
        household_id: household.id,
        invited_by_profile_id: profile.id,
        intended_role: data.role as Role,
        intended_privilege:
          data.role === "family_member" ? (data.privilege ?? "view_only") : ("full" as Privilege),
        code,
        token,
      })
      .select("code, token")
      .single();
    if (inv.error) throw new Error(inv.error.message);

    revalidatePath("/household/settings");
    return { code: inv.data.code, token: inv.data.token };
  }

  const revokeSchema = z.object({ inviteId: z.uuid() });
  export async function revokeInvite(input: unknown) {
    const data = revokeSchema.parse(input);
    const ctx = await getCurrentHousehold();
    if (!ctx) throw new Error("no active household");
    const svc = createServiceClient();
    const { error } = await svc
      .from("invites")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", data.inviteId);
    if (error) throw new Error(error.message);
    revalidatePath("/household/settings");
  }

  const redeemSchema = z.object({
    tokenOrCode: z.string().min(1).max(200),
  });
  export async function redeemInvite(input: unknown) {
    const data = redeemSchema.parse(input);
    const ctx = await getCurrentHousehold();
    if (ctx) redirect("/dashboard"); // already in a household; can't accept another in v1

    const svc = createServiceClient();

    // Resolve a code to a token if needed
    let token = data.tokenOrCode.trim();
    if (/^\d{6}$/.test(token)) {
      const r = await svc
        .from("invites")
        .select("token")
        .eq("code", token)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      if (r.error) throw new Error(r.error.message);
      const found = r.data?.[0]?.token;
      if (!found) throw new Error("invite not found or expired");
      token = found;
    }

    const rpc = await svc.rpc("redeem_invite", { p_token: token });
    if (rpc.error) throw new Error(rpc.error.message);

    revalidatePath("/dashboard");
    redirect("/dashboard");
  }

  const removeSchema = z.object({ membershipId: z.uuid() });
  export async function removeMembership(input: unknown) {
    const data = removeSchema.parse(input);
    const ctx = await getCurrentHousehold();
    if (!ctx) throw new Error("no active household");

    const svc = createServiceClient();
    const target = await svc
      .from("household_memberships")
      .select("*")
      .eq("id", data.membershipId)
      .single();
    if (target.error) throw new Error(target.error.message);

    const targetRow = target.data;
    if (targetRow.household_id !== ctx.household.id) throw new Error("forbidden");

    const isSelfLeave = targetRow.profile_id === ctx.profile.id;
    const isOwnerAction = ctx.membership.role === "owner";
    if (!isSelfLeave && !isOwnerAction) throw new Error("forbidden");

    if (targetRow.role === "owner" && isSelfLeave) {
      // Spec §5.6 — disallowed in v1
      throw new Error("an owner cannot self-leave; transfer ownership first (not in v1)");
    }

    const { error } = await svc
      .from("household_memberships")
      .update({ status: "removed", removed_at: new Date().toISOString() })
      .eq("id", data.membershipId);
    if (error) throw new Error(error.message);

    revalidatePath("/household/settings");
    revalidatePath("/dashboard");
  }

  const updatePrivSchema = z.object({
    membershipId: z.uuid(),
    privilege: z.enum(["full", "meal_modify", "view_only"]),
  });
  export async function updateMembershipPrivilege(input: unknown) {
    const data = updatePrivSchema.parse(input);
    const ctx = await getCurrentHousehold();
    if (!ctx) throw new Error("no active household");
    if (ctx.membership.role !== "owner") throw new Error("only the owner can change privileges");

    const svc = createServiceClient();
    const target = await svc
      .from("household_memberships")
      .select("household_id, role")
      .eq("id", data.membershipId)
      .single();
    if (target.error) throw new Error(target.error.message);
    if (target.data.household_id !== ctx.household.id) throw new Error("forbidden");
    if (target.data.role !== "family_member")
      throw new Error("privilege only applies to family members");

    const { error } = await svc
      .from("household_memberships")
      .update({ privilege: data.privilege })
      .eq("id", data.membershipId);
    if (error) throw new Error(error.message);

    revalidatePath("/household/settings");
  }
  ```

- [ ] **Step 2: Write tests for invite redemption (DB-level)**

  Create `tests/actions/invites.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { withTransaction } from "../setup";
  import {
    insertHousehold, insertInvite, insertMembership, insertProfile,
  } from "../factories";

  describe("redeem_invite end-to-end behavior", () => {
    it("creates a family_member membership with the privilege from the invite", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const fam = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
        const inv = await insertInvite(c, {
          household_id: h.id,
          invited_by_profile_id: owner.id,
          intended_role: "family_member",
          intended_privilege: "view_only",
        });
        await c.query(
          `select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
          [JSON.stringify({ sub: fam.clerk_user_id })],
        );
        const { rows } = await c.query("select * from redeem_invite($1)", [inv.token]);
        expect(rows[0].role).toBe("family_member");
        expect(rows[0].privilege).toBe("view_only");
      });
    });
  });
  ```

- [ ] **Step 3: Write tests for membership management (DB-level)**

  Create `tests/actions/memberships.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import {
    insertHousehold, insertMembership, insertProfile,
  } from "../factories";

  describe("membership management invariants", () => {
    it("self-leave sets status=removed", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const fam = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
        const fm = await insertMembership(c, {
          household_id: h.id, profile_id: fam.id, role: "family_member",
        });
        await setJwtClaims(c, { sub: fam.clerk_user_id });
        await c.query(
          `update household_memberships
              set status = 'removed', removed_at = now()
            where id = $1`,
          [fm.id],
        );
        const { rows } = await c.query(
          "select status from household_memberships where id = $1", [fm.id]);
        expect(rows[0].status).toBe("removed");
      });
    });

    it("after removal, a maid can be re-invited and join", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const m1 = await insertProfile(c);
        const m2 = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
        const m1m = await insertMembership(c, {
          household_id: h.id, profile_id: m1.id, role: "maid",
        });
        // owner removes m1
        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await c.query(
          "update household_memberships set status = 'removed', removed_at = now() where id = $1",
          [m1m.id],
        );
        // bypass RLS to insert m2 as new maid (simulating redeem_invite SECURITY DEFINER)
        await c.query(
          `select set_config('request.jwt.claims', '', true), set_config('role', 'postgres', true)`,
        );
        await insertMembership(c, { household_id: h.id, profile_id: m2.id, role: "maid" });
      });
    });
  });
  ```

- [ ] **Step 4: Verify**

  ```bash
  pnpm typecheck && pnpm test tests/
  ```

  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/household/settings/actions.ts \
          tests/actions/invites.test.ts tests/actions/memberships.test.ts
  git commit -m "Add invite + membership server actions with DB invariant tests"
  ```

---

## Task 12: Update `proxy.ts` — onboarding gate + protect routes

**Files:**

- Modify: `src/proxy.ts`

- [ ] **Step 1: Replace `src/proxy.ts`**

  ```ts
  import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
  import { NextResponse } from "next/server";

  const isPublic = createRouteMatcher([
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/join/(.*)",
    "/api/webhooks/(.*)",
  ]);

  const isAuthGated = createRouteMatcher([
    "/dashboard(.*)",
    "/household(.*)",
    "/onboarding(.*)",
  ]);

  export default clerkMiddleware(async (auth, req) => {
    if (isPublic(req)) return;

    const { userId } = await auth();
    if (!userId) {
      if (isAuthGated(req)) {
        const url = req.nextUrl.clone();
        url.pathname = "/";
        return NextResponse.redirect(url);
      }
      return;
    }

    // The /onboarding ↔ /dashboard gate is enforced by per-page redirects via
    // requireHousehold() / getCurrentHousehold(). proxy.ts only ensures auth.
  });

  export const config = {
    matcher: [
      "/((?!_next|sw\\.js|manifest\\.webmanifest|icon|apple-icon|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
      "/(api|trpc)(.*)",
    ],
  };
  ```

- [ ] **Step 2: Verify**

  ```bash
  pnpm typecheck
  ```

  Expected: passes.

- [ ] **Step 3: Commit**

  ```bash
  git add src/proxy.ts
  git commit -m "Tighten proxy.ts — public/auth-gated route matchers"
  ```

---

## Task 13: `/onboarding` chooser page + onboarding sub-forms

**Files:**

- Create: `src/app/onboarding/page.tsx`
- Create: `src/app/onboarding/maid/page.tsx`
- Create: `src/app/onboarding/owner/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add a Card component via shadcn**

  ```bash
  pnpm dlx shadcn@latest add card input label --yes
  ```

  Expected: creates `src/components/ui/card.tsx`, `input.tsx`, `label.tsx`.

- [ ] **Step 2: Write the chooser**

  Create `src/app/onboarding/page.tsx`:

  ```tsx
  import Link from "next/link";
  import { redirect } from "next/navigation";
  import { getCurrentHousehold } from "@/lib/auth/current-household";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";

  export default async function OnboardingPage() {
    if (await getCurrentHousehold()) redirect("/dashboard");

    return (
      <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome to Zomaid</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          How would you like to get started?
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>I'm an FDW</CardTitle>
              <CardDescription>Free. Add your owner's details to begin.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full"><Link href="/onboarding/maid">Continue</Link></Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>I'm an owner</CardTitle>
              <CardDescription>Start a household and invite your FDW + family.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full"><Link href="/onboarding/owner">Continue</Link></Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>I have an invite</CardTitle>
              <CardDescription>Got a 6-digit code or a link.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" className="w-full">
                <Link href="/join/code">Enter code</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }
  ```

  > Note: Base UI Button doesn't ship `asChild` in the scaffold. If `asChild` errors at typecheck, replace with `<Link>` styled via `buttonVariants()` (pattern already used in `src/app/page.tsx`).

- [ ] **Step 3: Write the maid form**

  Create `src/app/onboarding/maid/page.tsx`:

  ```tsx
  import { redirect } from "next/navigation";
  import { getCurrentHousehold } from "@/lib/auth/current-household";
  import { createHouseholdAsMaid } from "@/app/onboarding/actions";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";

  export default async function MaidOnboardingPage() {
    if (await getCurrentHousehold()) redirect("/dashboard");

    async function action(formData: FormData) {
      "use server";
      await createHouseholdAsMaid({
        ownerName: String(formData.get("ownerName") ?? "").trim(),
        ownerEmail: String(formData.get("ownerEmail") ?? "").trim(),
      });
    }

    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold sm:text-2xl">Tell us about your owner</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We'll create your household and send a join invite to your owner.
        </p>
        <form action={action} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ownerName">Owner's name</Label>
            <Input id="ownerName" name="ownerName" required maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ownerEmail">Owner's email</Label>
            <Input id="ownerEmail" name="ownerEmail" type="email" required maxLength={200} />
          </div>
          <Button type="submit" className="w-full">Continue</Button>
        </form>
      </main>
    );
  }
  ```

- [ ] **Step 4: Write the owner form**

  Create `src/app/onboarding/owner/page.tsx`:

  ```tsx
  import { redirect } from "next/navigation";
  import { getCurrentHousehold } from "@/lib/auth/current-household";
  import { createHouseholdAsOwner } from "@/app/onboarding/actions";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";

  export default async function OwnerOnboardingPage() {
    if (await getCurrentHousehold()) redirect("/dashboard");

    async function action(formData: FormData) {
      "use server";
      await createHouseholdAsOwner({
        name: String(formData.get("name") ?? "").trim(),
        addressLine: String(formData.get("addressLine") ?? "").trim() || undefined,
        postalCode: String(formData.get("postalCode") ?? "").trim() || undefined,
      });
    }

    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold sm:text-2xl">Start your household</h1>
        <form action={action} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Household name</Label>
            <Input id="name" name="name" required maxLength={100} placeholder="e.g. Tan Family" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addressLine">Address (optional)</Label>
            <Input id="addressLine" name="addressLine" maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postalCode">Postal code (optional)</Label>
            <Input id="postalCode" name="postalCode" maxLength={20} />
          </div>
          <Button type="submit" className="w-full">Continue</Button>
        </form>
      </main>
    );
  }
  ```

- [ ] **Step 5: Update `/` to redirect signed-in users appropriately**

  Replace `src/app/page.tsx`:

  ```tsx
  import {
    Show, SignInButton, SignUpButton, UserButton,
  } from "@clerk/nextjs";
  import Link from "next/link";
  import { redirect } from "next/navigation";
  import { auth } from "@clerk/nextjs/server";
  import { getCurrentHousehold } from "@/lib/auth/current-household";
  import { Button, buttonVariants } from "@/components/ui/button";
  import { cn } from "@/lib/utils";

  export default async function Home() {
    const { userId } = await auth();
    if (userId) {
      const ctx = await getCurrentHousehold();
      redirect(ctx ? "/dashboard" : "/onboarding");
    }

    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-6 p-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Zomaid</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          The household app for FDWs and the families they work for.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Show when="signed-out">
            <SignInButton mode="modal"><Button>Sign in</Button></SignInButton>
            <SignUpButton mode="modal"><Button variant="outline">Sign up</Button></SignUpButton>
          </Show>
          <Show when="signed-in">
            <Link href="/dashboard" className={cn(buttonVariants())}>Go to app</Link>
            <UserButton />
          </Show>
        </div>
      </main>
    );
  }
  ```

- [ ] **Step 6: Verify**

  ```bash
  pnpm typecheck
  ```

  If `asChild` on Button is not available, replace `<Button asChild>` with a styled `<Link>` using `buttonVariants()` per the existing pattern.

- [ ] **Step 7: Commit**

  ```bash
  git add src/app/onboarding/ src/app/page.tsx src/components/ui/card.tsx src/components/ui/input.tsx src/components/ui/label.tsx
  git commit -m "Add /onboarding chooser + maid/owner sub-forms; redirect / based on session"
  ```

---

## Task 14: `/join/[token]` and `/join/code` redeem flow

**Files:**

- Create: `src/app/join/[token]/page.tsx`
- Create: `src/app/join/code/page.tsx`

- [ ] **Step 1: Token page (auto-redeems if signed in)**

  ```tsx
  // src/app/join/[token]/page.tsx
  import { redirect } from "next/navigation";
  import { auth } from "@clerk/nextjs/server";
  import { redeemInvite } from "@/app/household/settings/actions";

  type Params = { params: Promise<{ token: string }> };

  export default async function JoinTokenPage({ params }: Params) {
    const { token } = await params;
    const { userId } = await auth();

    if (!userId) {
      // Pass token through Clerk's after-sign-in redirect
      redirect(
        `/?redirect_url=${encodeURIComponent(`/join/${token}`)}`,
      );
    }

    try {
      await redeemInvite({ tokenOrCode: token });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "could not join";
      return (
        <main className="mx-auto max-w-md px-4 py-10">
          <h1 className="text-xl font-semibold">Could not join</h1>
          <p className="mt-2 text-sm text-muted-foreground">{msg}</p>
        </main>
      );
    }
    redirect("/dashboard");
  }
  ```

- [ ] **Step 2: Code-entry page**

  ```tsx
  // src/app/join/code/page.tsx
  import { redirect } from "next/navigation";
  import { auth } from "@clerk/nextjs/server";
  import { redeemInvite } from "@/app/household/settings/actions";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";

  export default async function JoinCodePage() {
    const { userId } = await auth();
    if (!userId) redirect(`/?redirect_url=${encodeURIComponent("/join/code")}`);

    async function action(formData: FormData) {
      "use server";
      await redeemInvite({ tokenOrCode: String(formData.get("code") ?? "").trim() });
    }

    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold">Enter your invite code</h1>
        <form action={action} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="code">6-digit code</Label>
            <Input id="code" name="code" required minLength={6} maxLength={6} pattern="\d{6}" inputMode="numeric" />
          </div>
          <Button type="submit" className="w-full">Join household</Button>
        </form>
      </main>
    );
  }
  ```

- [ ] **Step 3: Verify**

  ```bash
  pnpm typecheck
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/join
  git commit -m "Add /join/[token] auto-redeem and /join/code entry page"
  ```

---

## Task 15: Dashboard placeholder rebuild

**Files:**

- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Rebuild dashboard as the foundations placeholder**

  Replace `src/app/dashboard/page.tsx`:

  ```tsx
  import Link from "next/link";
  import { requireHousehold } from "@/lib/auth/require";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
  import { Button, buttonVariants } from "@/components/ui/button";
  import { cn } from "@/lib/utils";

  type SearchParams = Promise<{ ownerInvite?: string }>;

  export default async function DashboardPage({
    searchParams,
  }: { searchParams: SearchParams }) {
    const ctx = await requireHousehold();
    const sp = await searchParams;

    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{ctx.household.name}</h1>
            <p className="text-sm text-muted-foreground">
              You are signed in as <strong>{ctx.profile.display_name}</strong> ({ctx.membership.role}).
            </p>
          </div>
          <Link href="/household/settings" className={cn(buttonVariants({ variant: "outline" }))}>
            Settings
          </Link>
        </div>

        {sp.ownerInvite ? (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Share this link with your owner</CardTitle>
              <CardDescription>One-time link, expires in 7 days.</CardDescription>
            </CardHeader>
            <CardContent>
              <code className="block break-all rounded-md bg-muted p-3 text-xs">
                {`/join/${sp.ownerInvite}`}
              </code>
            </CardContent>
          </Card>
        ) : null}

        <section className="mt-8">
          <h2 className="text-lg font-medium">Coming soon</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              ["Recipes & meal plan", "Plan today's breakfast, lunch, dinner."],
              ["Inventory & bills", "Scan grocery bills, track items."],
              ["Fridge", "Track what's inside, when it expires."],
              ["Tasks", "Recurring household tasks with reminders."],
            ].map(([title, desc]) => (
              <Card key={title} aria-disabled className="opacity-60">
                <CardHeader>
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button disabled variant="outline" className="w-full">Soon</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 2: Verify**

  ```bash
  pnpm typecheck
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/dashboard/page.tsx
  git commit -m "Rebuild dashboard as foundations placeholder with member context"
  ```

---

## Task 16: `/household/settings` page

**Files:**

- Create: `src/app/household/settings/page.tsx`

- [ ] **Step 1: Build the settings page**

  ```tsx
  // src/app/household/settings/page.tsx
  import { requireHousehold } from "@/lib/auth/require";
  import { createServiceClient } from "@/lib/supabase/server";
  import {
    createInvite, removeMembership, updateMembershipPrivilege,
  } from "@/app/household/settings/actions";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { Label } from "@/components/ui/label";
  import type { Privilege, Role } from "@/lib/db/types";

  export default async function HouseholdSettingsPage() {
    const ctx = await requireHousehold();
    const svc = createServiceClient();

    const [members, invites] = await Promise.all([
      svc
        .from("household_memberships")
        .select("id, role, privilege, status, profile:profiles(id, display_name, email)")
        .eq("household_id", ctx.household.id)
        .eq("status", "active"),
      svc
        .from("invites")
        .select("id, intended_role, intended_privilege, code, token, expires_at, consumed_at")
        .eq("household_id", ctx.household.id)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
    ]);
    if (members.error) throw new Error(members.error.message);
    if (invites.error) throw new Error(invites.error.message);

    const isOwner = ctx.membership.role === "owner";
    const isMaid  = ctx.membership.role === "maid";

    async function inviteFamily(formData: FormData) {
      "use server";
      await createInvite({
        role: "family_member",
        privilege: (formData.get("privilege") ?? "view_only") as Privilege,
      });
    }
    async function inviteMaid() {
      "use server";
      await createInvite({ role: "maid" });
    }
    async function inviteOwner() {
      "use server";
      await createInvite({ role: "owner" });
    }
    async function remove(formData: FormData) {
      "use server";
      await removeMembership({ membershipId: String(formData.get("membershipId")) });
    }
    async function changePriv(formData: FormData) {
      "use server";
      await updateMembershipPrivilege({
        membershipId: String(formData.get("membershipId")),
        privilege: String(formData.get("privilege")) as Privilege,
      });
    }

    return (
      <main className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{ctx.household.name}</h1>
          <p className="text-sm text-muted-foreground">Household settings</p>
        </header>

        <Card>
          <CardHeader><CardTitle>Members</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {members.data!.map((m) => {
                const p = (m as unknown as { profile: { id: string; display_name: string; email: string } }).profile;
                const canRemove =
                  isOwner ? m.role !== "owner" || p.id !== ctx.profile.id
                          : p.id === ctx.profile.id && m.role !== "owner";
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium">{p.display_name || p.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.role}
                        {m.role === "family_member" ? ` · ${m.privilege}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isOwner && m.role === "family_member" ? (
                        <form action={changePriv} className="flex items-center gap-2">
                          <input type="hidden" name="membershipId" value={m.id} />
                          <select name="privilege" defaultValue={m.privilege} className="rounded-md border bg-background px-2 py-1 text-sm">
                            <option value="meal_modify">meal_modify</option>
                            <option value="view_only">view_only</option>
                          </select>
                          <Button type="submit" size="sm" variant="outline">Update</Button>
                        </form>
                      ) : null}
                      {canRemove ? (
                        <form action={remove}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <Button type="submit" size="sm" variant="destructive">
                            {p.id === ctx.profile.id ? "Leave" : "Remove"}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Invites</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {isOwner ? (
              <form action={inviteFamily} className="flex flex-wrap items-end gap-3">
                <div className="grow space-y-1.5">
                  <Label htmlFor="privilege">Family member privilege</Label>
                  <select name="privilege" id="privilege" defaultValue="view_only"
                          className="block w-full rounded-md border bg-background px-2 py-1 text-sm">
                    <option value="view_only">view_only ($5)</option>
                    <option value="meal_modify">meal_modify ($9)</option>
                  </select>
                </div>
                <Button type="submit">Invite family member</Button>
              </form>
            ) : null}
            {isOwner ? (
              <form action={inviteMaid}>
                <Button type="submit" variant="outline">Invite maid</Button>
              </form>
            ) : null}
            {isMaid ? (
              <form action={inviteOwner}>
                <Button type="submit" variant="outline">Invite owner</Button>
              </form>
            ) : null}

            {invites.data!.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active invites.</p>
            ) : (
              <ul className="divide-y">
                {invites.data!.map((i) => (
                  <li key={i.id} className="space-y-1 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{i.intended_role}</span>
                      <span className="text-xs text-muted-foreground">code: <code>{i.code}</code></span>
                    </div>
                    <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                      {`/join/${i.token}`}
                    </code>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }
  ```

- [ ] **Step 2: Verify**

  ```bash
  pnpm typecheck && pnpm dev
  ```

  Manually visit `http://localhost:3000` (sign in via Clerk's keyless dev mode), create an owner household, then visit `/household/settings`. Confirm members list, invite forms render. Stop dev server with Ctrl-C.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/household/settings/page.tsx
  git commit -m "Add /household/settings with member list, invites, privilege controls"
  ```

---

## Task 17: Admin env-var sync boot task

**Files:**

- Create: `src/lib/admin/env-sync.ts`
- Create: `src/instrumentation.ts`
- Create: `tests/admin/env-sync.test.ts`

- [ ] **Step 1: Write the test first**

  Create `tests/admin/env-sync.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { withTransaction } from "../setup";
  import { insertProfile } from "../factories";
  import { syncAdminFlags } from "@/lib/admin/env-sync";

  // We don't import createServiceClient here; the helper accepts a client to keep it testable.

  describe("syncAdminFlags", () => {
    it("flags listed clerk_user_ids as admin", async () => {
      await withTransaction(async (c) => {
        const a = await insertProfile(c, { is_admin: false });
        const b = await insertProfile(c, { is_admin: false });

        await syncAdminFlags({ clerkUserIds: [a.clerk_user_id], pgClient: c });

        const { rows } = await c.query(
          "select clerk_user_id, is_admin from profiles where id = any($1) order by id",
          [[a.id, b.id]],
        );
        const map = new Map(rows.map((r) => [r.clerk_user_id, r.is_admin]));
        expect(map.get(a.clerk_user_id)).toBe(true);
        expect(map.get(b.clerk_user_id)).toBe(false);
      });
    });

    it("clears admin from previously-flagged users no longer in env", async () => {
      await withTransaction(async (c) => {
        const a = await insertProfile(c, { is_admin: true });
        await syncAdminFlags({ clerkUserIds: [], pgClient: c });
        const { rows } = await c.query("select is_admin from profiles where id = $1", [a.id]);
        expect(rows[0].is_admin).toBe(false);
      });
    });
  });
  ```

- [ ] **Step 2: Run — fails**

  ```bash
  pnpm test tests/admin/env-sync.test.ts
  ```

  Expected: import resolution error.

- [ ] **Step 3: Implement `env-sync.ts`**

  ```ts
  import "server-only";
  import type { Client } from "pg";
  import { createServiceClient } from "@/lib/supabase/server";

  export async function syncAdminFlags(opts: {
    clerkUserIds: string[];
    /** Optional pg client for tests. If absent, uses Supabase service role. */
    pgClient?: Client;
  }): Promise<void> {
    const ids = opts.clerkUserIds.map((s) => s.trim()).filter(Boolean);

    if (opts.pgClient) {
      // Test path: direct SQL with a regular client
      await opts.pgClient.query(
        `update profiles set is_admin = (clerk_user_id = any($1))`,
        [ids],
      );
      return;
    }

    const svc = createServiceClient();
    const flag = await svc
      .from("profiles")
      .update({ is_admin: true })
      .in("clerk_user_id", ids.length ? ids : ["__none__"]);
    if (flag.error) throw new Error(flag.error.message);
    const unflag = await svc
      .from("profiles")
      .update({ is_admin: false })
      .not("clerk_user_id", "in", `(${ids.length ? ids.map((id) => `"${id}"`).join(",") : '""'})`);
    if (unflag.error) throw new Error(unflag.error.message);
  }

  export function readAdminEnv(): string[] {
    const raw = process.env.ZOMAID_ADMIN_CLERK_USER_IDS ?? "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  ```

- [ ] **Step 4: Implement Next.js instrumentation hook**

  Create `src/instrumentation.ts`:

  ```ts
  export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const { syncAdminFlags, readAdminEnv } = await import("@/lib/admin/env-sync");
      try {
        await syncAdminFlags({ clerkUserIds: readAdminEnv() });
      } catch (e) {
        console.error("[zomaid] admin env sync failed:", e);
      }
    }
  }
  ```

  Next.js will auto-call `register()` on boot.

- [ ] **Step 5: Run the test**

  ```bash
  pnpm test tests/admin/env-sync.test.ts
  ```

  Expected: 2 pass.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/admin/env-sync.ts src/instrumentation.ts tests/admin/env-sync.test.ts
  git commit -m "Add admin env-var sync boot task with tests"
  ```

---

## Task 18: End-to-end happy paths (Playwright)

**Files:**

- Create: `tests/e2e/foundations.spec.ts`
- Modify: `package.json` (add `e2e:setup` if needed)

> The E2E test relies on Clerk **dev keys** (the keyless mode shown in the scaffold dev log) or a real Clerk dev instance. For automated CI runs you'd need test users; for local validation we exercise the flows manually first, then code only the assertions that don't require Clerk credentials.

- [ ] **Step 1: Write a smoke E2E that the unauthenticated flow renders correctly**

  Create `tests/e2e/foundations.spec.ts`:

  ```ts
  import { expect, test } from "@playwright/test";

  test.describe("foundations — unauthenticated UI", () => {
    test("home renders sign-in CTA", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Zomaid" })).toBeVisible();
      await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    });

    test("/dashboard redirects unauthenticated users to /", async ({ page }) => {
      const resp = await page.goto("/dashboard");
      expect(resp?.url()).toMatch(/\/$/);
    });

    test("/onboarding redirects unauthenticated users to /", async ({ page }) => {
      const resp = await page.goto("/onboarding");
      expect(resp?.url()).toMatch(/\/$/);
    });
  });
  ```

- [ ] **Step 2: Run E2E**

  ```bash
  pnpm test:e2e
  ```

  Expected: 3 tests pass against a freshly-started dev server (Playwright spawns it via `playwright.config.ts`'s `webServer`).

- [ ] **Step 3: Add a manual-test checklist to the plan**

  These cannot be automated without a dedicated Clerk test instance + JWT-templates plumbed in. Walk through them yourself after Task 18 is committed:

  - [ ] **Owner-led onboarding**: sign in → land on `/onboarding` → click "I'm an owner" → submit form → land on `/dashboard` showing household name.
  - [ ] **Maid-led onboarding**: incognito sign-in as a different Gmail → "I'm an FDW" → fill owner email → land on `/dashboard?ownerInvite=...` → confirm invite link is shown.
  - [ ] **Family-member invite + redeem**: from owner's `/household/settings`, "Invite family member" with `meal_modify` → copy `/join/<token>` link → open in a third Gmail incognito → confirm redirect to `/dashboard` and member listed in settings.
  - [ ] **Maid removal**: owner clicks "Remove" on the maid → maid's next dashboard visit shows "no active household" → maid lands on `/onboarding`.
  - [ ] **Self-leave (family member)**: family member clicks "Leave" on own row → next visit shows `/onboarding`.
  - [ ] **Privilege toggle**: owner changes a family member from `view_only` to `meal_modify` → row updates immediately.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/e2e/foundations.spec.ts
  git commit -m "Add Playwright smoke tests for unauthenticated UI"
  ```

---

## Wrap-up

- [ ] **Run the full test suite**

  ```bash
  pnpm typecheck && pnpm test && pnpm test:e2e
  ```

  Expected: all green.

- [ ] **Push**

  ```bash
  git push origin main
  ```

- [ ] **Verify the prod build**

  ```bash
  pnpm build
  ```

  Expected: Next.js build succeeds. Webpack-mode build is required because Serwist's plugin attaches to webpack only; this is wired via the `build` script.

  If you see "missing service worker" warnings, check that `public/sw.js` was generated (it's gitignored — that's expected).

---

## What's *not* in this plan (deferred to later slices)

- Real email delivery for invites (slice "billing/SES infra" or earlier).
- Push notifications for tasks (slice 5).
- Admin UI (slice 7).
- Multi-household switcher UI (a later UX iteration).
- Account deletion / GDPR-style erasure.
- pgtap or generated Supabase types (we hand-curate in `src/lib/db/types.ts` for v1).

These are explicit non-goals from the spec §11.
