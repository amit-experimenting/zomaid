# Maid Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a personal-profile onboarding step between invite redemption and the dashboard for maids; expose the same form under household settings for editing later.

**Architecture:** Extend `public.profiles` with four nullable columns (`passport_number`, `passport_expiry`, `preferred_language`, `onboarding_completed_at`). Build a single shared client form (`PersonalProfileForm`) consumed by two routes: a first-run `/onboarding/personal` page (entered post-redeem) and a long-lived `/household/settings/me` edit page. A single server action (`savePersonalProfile`) writes both, stamping `onboarding_completed_at` only on first save. A maid-only redirect gate on `/dashboard` ensures pre-existing maids also pass through the form on next visit.

**Tech Stack:** Next.js 16 (App Router), Clerk (auth), Supabase (Postgres + JS SDK), Zod (validation), Vitest (unit/integration), Playwright (E2E).

**Spec:** [docs/superpowers/specs/2026-05-17-maid-onboarding-design.md](../specs/2026-05-17-maid-onboarding-design.md)

**Naming note:** `/onboarding/profile` and `src/app/onboarding/profile/profile-form.tsx` are already taken by the household-questionnaire feature (table `household_profiles`). This plan uses the `personal` / `personal-profile-form` / `me` namespace to avoid collision. Do not rename the existing household-questionnaire files.

---

## File Structure

**Create:**
- `supabase/migrations/20260517_001_profiles_personal_fields.sql` — schema
- `src/lib/profile/languages.ts` — language code/label registry
- `src/lib/profile/personal.ts` — Zod schema + types, shared by action + form
- `src/components/profile/personal-profile-form.tsx` — client form
- `src/app/onboarding/personal/page.tsx` — first-run gate + form host
- `src/app/onboarding/personal/actions.ts` — `savePersonalProfile()` action
- `src/app/household/settings/me/page.tsx` — settings edit page
- `tests/actions/personal-profile.test.ts` — action integration test
- `tests/unit/personal-profile-schema.test.ts` — Zod schema unit test
- `tests/e2e/maid-onboarding.spec.ts` — Playwright E2E (existing tests)

**Modify:**
- `src/lib/db/types.ts` — extend `profiles.Row` / `Insert` / `Update`
- `src/app/join/[token]/page.tsx:32` — change post-redeem redirect target
- `src/app/dashboard/page.tsx` — maid-only onboarding gate
- `src/app/household/settings/page.tsx` — add "My Profile" card with link

---

## Task 1: Migration — add personal fields to profiles

**Files:**
- Create: `supabase/migrations/20260517_001_profiles_personal_fields.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Personal-profile fields collected during maid onboarding. All nullable.
-- onboarding_completed_at: NULL = "show onboarding when the gate fires";
-- set = "user has been through the flow and continued."
-- Per spec: no backfill — existing maids must pass through the new form on
-- next visit. Owners are protected by a role-scoped gate, not by data.

alter table public.profiles
  add column passport_number       text,
  add column passport_expiry       date,
  add column preferred_language    text,
  add column onboarding_completed_at timestamptz;
```

- [ ] **Step 2: Apply locally**

Run: `pnpm db:reset`
Expected: migration applies cleanly, no errors. Subsequent `\d profiles` (via `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`) should show the four new columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260517_001_profiles_personal_fields.sql
git commit -m "feat(db): add personal fields + onboarding_completed_at to profiles"
```

---

## Task 2: Extend the Database type

**Files:**
- Modify: `src/lib/db/types.ts` — `profiles.Row`, `profiles.Insert`, `profiles.Update`

- [ ] **Step 1: Add fields to the Row, Insert, and Update shapes**

Edit `src/lib/db/types.ts`. Find the `profiles:` block (around line 13) and replace:

```ts
      profiles: {
        Row: {
          id: string;
          clerk_user_id: string;
          email: string;
          display_name: string;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          clerk_user_id: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
```

with:

```ts
      profiles: {
        Row: {
          id: string;
          clerk_user_id: string;
          email: string;
          display_name: string;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
          passport_number: string | null;
          passport_expiry: string | null;        // ISO date "YYYY-MM-DD"
          preferred_language: string | null;
          onboarding_completed_at: string | null; // ISO timestamp
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          clerk_user_id: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (The new columns are nullable, so existing code that doesn't reference them keeps compiling.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/types.ts
git commit -m "feat(types): add personal-profile columns to profiles type"
```

---

## Task 3: Language registry

**Files:**
- Create: `src/lib/profile/languages.ts`

- [ ] **Step 1: Write the module**

```ts
// src/lib/profile/languages.ts
// Stored as short codes in the DB so labels can be localized later without a
// data migration. Order is the display order in the dropdown.

export const LANGUAGE_CODES = [
  "en", "hi", "ta", "te", "kn", "mr", "bn", "ml", "mni", "lus", "pa",
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

const LABELS: Record<LanguageCode, string> = {
  en:  "English",
  hi:  "Hindi",
  ta:  "Tamil",
  te:  "Telugu",
  kn:  "Kannada",
  mr:  "Marathi",
  bn:  "Bengali",
  ml:  "Malayalam",
  mni: "Manipuri",
  lus: "Mizo",
  pa:  "Punjabi",
};

export function languageLabel(code: LanguageCode): string {
  return LABELS[code];
}

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/profile/languages.ts
git commit -m "feat(profile): add language registry for personal profiles"
```

---

## Task 4: Personal-profile Zod schema + types (TDD)

**Files:**
- Create: `tests/unit/personal-profile-schema.test.ts` (first)
- Create: `src/lib/profile/personal.ts` (then)

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/unit/personal-profile-schema.test.ts
import { describe, expect, it } from "vitest";
import { personalProfileSchema } from "@/lib/profile/personal";

describe("personalProfileSchema", () => {
  it("accepts the minimum valid payload (name only)", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Empty optional fields normalize to null.
      expect(r.data.passport_number).toBeNull();
      expect(r.data.passport_expiry).toBeNull();
      expect(r.data.preferred_language).toBeNull();
      expect(r.data.display_name).toBe("Asha");
    }
  });

  it("rejects an empty name", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "   ",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "",
    });
    expect(r.success).toBe(false);
  });

  it("trims the name", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "  Asha  ",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.display_name).toBe("Asha");
  });

  it("accepts a full payload", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "P1234567",
      passport_expiry: "2030-01-15",
      preferred_language: "ta",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.passport_number).toBe("P1234567");
      expect(r.data.passport_expiry).toBe("2030-01-15");
      expect(r.data.preferred_language).toBe("ta");
    }
  });

  it("rejects an unknown language code", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "xx",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-ISO date for passport_expiry", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "",
      passport_expiry: "15/01/2030",
      preferred_language: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a too-long passport number", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "x".repeat(65),
      passport_expiry: "",
      preferred_language: "",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/unit/personal-profile-schema.test.ts`
Expected: FAIL — `Cannot find module '@/lib/profile/personal'`.

- [ ] **Step 3: Implement the schema**

```ts
// src/lib/profile/personal.ts
import { z } from "zod";
import { LANGUAGE_CODES } from "./languages";

// Empty strings (the natural form-field zero value) normalize to null so the
// caller can shovel form data straight in without distinguishing "" vs missing.
const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

export const personalProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long"),
  passport_number: z
    .preprocess(emptyToNull, z.string().trim().max(64).nullable())
    .optional()
    .transform((v) => v ?? null),
  passport_expiry: z
    .preprocess(emptyToNull, z.iso.date().nullable())
    .optional()
    .transform((v) => v ?? null),
  preferred_language: z
    .preprocess(emptyToNull, z.enum(LANGUAGE_CODES).nullable())
    .optional()
    .transform((v) => v ?? null),
});

export type PersonalProfileInput = z.infer<typeof personalProfileSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/unit/personal-profile-schema.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/unit/personal-profile-schema.test.ts src/lib/profile/personal.ts
git commit -m "feat(profile): add personal-profile Zod schema with unit tests"
```

---

## Task 5: `savePersonalProfile` server action (TDD)

**Files:**
- Create: `tests/actions/personal-profile.test.ts` (first)
- Create: `src/app/onboarding/personal/actions.ts` (then)

- [ ] **Step 1: Write the failing action test**

```ts
// tests/actions/personal-profile.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClerk } from "../helpers/clerk";
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
};
function freshIds(): Ids {
  return { profiles: [], households: [], memberships: [] };
}
async function cleanupAll(ids: Ids): Promise<void> {
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

async function setupMaidInHousehold(ids: Ids) {
  const owner = await createProfile();
  ids.profiles.push(owner.id);
  const h = await createHousehold({ created_by_profile_id: owner.id });
  ids.households.push(h.id);
  const ownerM = await createMembership({
    household_id: h.id,
    profile_id: owner.id,
    role: "owner",
  });
  ids.memberships.push(ownerM.id);

  const maid = await createProfile();
  ids.profiles.push(maid.id);
  const maidM = await createMembership({
    household_id: h.id,
    profile_id: maid.id,
    role: "maid",
  });
  ids.memberships.push(maidM.id);
  return { maid, household: h };
}

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) fd.set(k, v);
  return fd;
}

describe("savePersonalProfile (action)", () => {
  const ids = freshIds();
  beforeEach(() => { vi.resetModules(); });
  afterEach(async () => { await cleanupAll(ids); });

  it("writes the row, stamps onboarding_completed_at, redirects to /dashboard", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    const fd = formDataFrom({
      display_name: "Asha",
      passport_number: "P1234567",
      passport_expiry: "2030-01-15",
      preferred_language: "ta",
      redirect_to: "/dashboard",
    });

    await expectRedirect(savePersonalProfile(fd), "/dashboard");

    const { data: row } = await serviceClient()
      .from("profiles")
      .select("display_name, passport_number, passport_expiry, preferred_language, onboarding_completed_at")
      .eq("id", maid.id)
      .single();
    expect(row?.display_name).toBe("Asha");
    expect(row?.passport_number).toBe("P1234567");
    expect(row?.passport_expiry).toBe("2030-01-15");
    expect(row?.preferred_language).toBe("ta");
    expect(row?.onboarding_completed_at).not.toBeNull();
  });

  it("accepts minimal payload (name only), normalizes empty fields to null", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    const fd = formDataFrom({
      display_name: "Asha",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "",
      redirect_to: "/dashboard",
    });

    await expectRedirect(savePersonalProfile(fd), "/dashboard");

    const { data: row } = await serviceClient()
      .from("profiles")
      .select("passport_number, passport_expiry, preferred_language, onboarding_completed_at")
      .eq("id", maid.id)
      .single();
    expect(row?.passport_number).toBeNull();
    expect(row?.passport_expiry).toBeNull();
    expect(row?.preferred_language).toBeNull();
    expect(row?.onboarding_completed_at).not.toBeNull();
  });

  it("does NOT re-stamp onboarding_completed_at on a second save", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    await expectRedirect(
      savePersonalProfile(formDataFrom({
        display_name: "Asha",
        passport_number: "", passport_expiry: "", preferred_language: "",
        redirect_to: "/dashboard",
      })),
      "/dashboard",
    );
    const first = await serviceClient()
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("id", maid.id)
      .single();
    const firstStamp = first.data?.onboarding_completed_at;
    expect(firstStamp).not.toBeNull();

    // Second save (later edit from settings).
    await new Promise((r) => setTimeout(r, 10));
    await expectRedirect(
      savePersonalProfile(formDataFrom({
        display_name: "Asha Devi",
        passport_number: "P999", passport_expiry: "", preferred_language: "",
        redirect_to: "/household/settings",
      })),
      "/household/settings",
    );
    const second = await serviceClient()
      .from("profiles")
      .select("display_name, passport_number, onboarding_completed_at")
      .eq("id", maid.id)
      .single();
    expect(second.data?.display_name).toBe("Asha Devi");
    expect(second.data?.passport_number).toBe("P999");
    expect(second.data?.onboarding_completed_at).toBe(firstStamp);
  });

  it("redirects to the redirect_to target from the form", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    await expectRedirect(
      savePersonalProfile(formDataFrom({
        display_name: "Asha",
        passport_number: "", passport_expiry: "", preferred_language: "",
        redirect_to: "/household/settings",
      })),
      "/household/settings",
    );
  });

  it("throws when display_name is empty", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    await expect(
      savePersonalProfile(formDataFrom({
        display_name: "",
        passport_number: "", passport_expiry: "", preferred_language: "",
        redirect_to: "/dashboard",
      })),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/actions/personal-profile.test.ts`
Expected: FAIL — `Cannot find module '@/app/onboarding/personal/actions'`.

- [ ] **Step 3: Implement the action**

```ts
// src/app/onboarding/personal/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceClient } from "@/lib/supabase/server";
import { personalProfileSchema } from "@/lib/profile/personal";

const ALLOWED_REDIRECTS = new Set(["/dashboard", "/household/settings"]);

export async function savePersonalProfile(formData: FormData): Promise<void> {
  const parsed = personalProfileSchema.parse({
    display_name:       formData.get("display_name")       ?? "",
    passport_number:    formData.get("passport_number")    ?? "",
    passport_expiry:    formData.get("passport_expiry")    ?? "",
    preferred_language: formData.get("preferred_language") ?? "",
  });

  const rawRedirect = String(formData.get("redirect_to") ?? "/dashboard");
  const target = ALLOWED_REDIRECTS.has(rawRedirect) ? rawRedirect : "/dashboard";

  const profile = await getCurrentProfile();
  const svc = createServiceClient();

  // Stamp onboarding_completed_at only if currently NULL: first save through
  // any surface marks the user as onboarded; later edits leave it alone.
  const update: Record<string, unknown> = {
    display_name:       parsed.display_name,
    passport_number:    parsed.passport_number,
    passport_expiry:    parsed.passport_expiry,
    preferred_language: parsed.preferred_language,
  };
  if (profile.onboarding_completed_at == null) {
    update.onboarding_completed_at = new Date().toISOString();
  }

  const { error } = await svc
    .from("profiles")
    .update(update)
    .eq("id", profile.id);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/household/settings");
  redirect(target);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/actions/personal-profile.test.ts`
Expected: PASS (5 tests). Requires local Supabase running (`pnpm db:start` first) with `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

- [ ] **Step 5: Commit**

```bash
git add tests/actions/personal-profile.test.ts src/app/onboarding/personal/actions.ts
git commit -m "feat(profile): add savePersonalProfile server action with first-save stamp"
```

---

## Task 6: `PersonalProfileForm` client component

**Files:**
- Create: `src/components/profile/personal-profile-form.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/profile/personal-profile-form.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { LANGUAGE_CODES, languageLabel, type LanguageCode } from "@/lib/profile/languages";

type Initial = {
  display_name: string;
  passport_number: string | null;
  passport_expiry: string | null;       // YYYY-MM-DD
  preferred_language: string | null;
};

type Props = {
  initial: Initial;
  action: (formData: FormData) => Promise<void>;
  redirectTo: "/dashboard" | "/household/settings";
  submitLabel: string;
};

export function PersonalProfileForm({ initial, action, redirectTo, submitLabel }: Props) {
  const [name, setName] = useState(initial.display_name);
  const valid = name.trim().length > 0;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="redirect_to" value={redirectTo} />

      <div className="space-y-1.5">
        <Label htmlFor="display_name">Your name</Label>
        <Input
          id="display_name"
          name="display_name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
        <p className="text-xs text-text-muted">Required. Edit if the auto-filled name isn&apos;t right.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passport_number">Passport number (optional)</Label>
        <Input
          id="passport_number"
          name="passport_number"
          maxLength={64}
          defaultValue={initial.passport_number ?? ""}
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passport_expiry">Passport expiry (optional)</Label>
        <Input
          id="passport_expiry"
          name="passport_expiry"
          type="date"
          defaultValue={initial.passport_expiry ?? ""}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="preferred_language">Preferred language (optional)</Label>
        <select
          id="preferred_language"
          name="preferred_language"
          defaultValue={initial.preferred_language ?? ""}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-11"
        >
          <option value="">— Select —</option>
          {LANGUAGE_CODES.map((code: LanguageCode) => (
            <option key={code} value={code}>{languageLabel(code)}</option>
          ))}
        </select>
      </div>

      <SubmitButton disabled={!valid} className="w-full">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Lint (catches design-system rules — banned hex/oklch, missing aria-label, etc.)**

Run: `pnpm lint`
Expected: no errors on the new file.

- [ ] **Step 4: Commit**

```bash
git add src/components/profile/personal-profile-form.tsx
git commit -m "feat(profile): add PersonalProfileForm shared between onboarding and settings"
```

---

## Task 7: Onboarding page (`/onboarding/personal`)

**Files:**
- Create: `src/app/onboarding/personal/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/onboarding/personal/page.tsx
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { PersonalProfileForm } from "@/components/profile/personal-profile-form";
import { savePersonalProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPersonalPage() {
  const profile = await getCurrentProfile();

  if (profile.onboarding_completed_at != null) {
    redirect("/dashboard");
  }

  // Pre-fill name from Clerk when the profile's display_name hasn't been set
  // by the user yet (current-profile.ts seeds it from Clerk on lazy-upsert,
  // so this branch is rarely hit, but keeps the form sensible if it's empty).
  let prefillName = profile.display_name;
  if (!prefillName.trim()) {
    const u = await currentUser();
    const fromClerk = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
    prefillName = fromClerk || "";
  }

  return (
    <main className="mx-auto max-w-md">
      <TopAppBar title="Welcome" subtitle="A few quick details (most are optional)" />
      <div className="px-4 py-6">
        <PersonalProfileForm
          initial={{
            display_name: prefillName,
            passport_number: profile.passport_number,
            passport_expiry: profile.passport_expiry,
            preferred_language: profile.preferred_language,
          }}
          action={savePersonalProfile}
          redirectTo="/dashboard"
          submitLabel="Save & continue →"
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Manual sanity check**

Run: `pnpm dev`
Visit `http://localhost:3000/onboarding/personal` while signed in. Expected: form renders with name pre-filled from your Clerk account, three optional fields below, "Save & continue →" button. Clicking it should write the row and bounce you to `/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/personal/page.tsx
git commit -m "feat(onboarding): add /onboarding/personal first-run profile page"
```

---

## Task 8: Settings sub-route (`/household/settings/me`)

**Files:**
- Create: `src/app/household/settings/me/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/household/settings/me/page.tsx
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { IconButton } from "@/components/ui/icon-button";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { PersonalProfileForm } from "@/components/profile/personal-profile-form";
import { savePersonalProfile } from "@/app/onboarding/personal/actions";

export const dynamic = "force-dynamic";

export default async function MyProfileSettingsPage() {
  const profile = await getCurrentProfile();

  return (
    <main className="mx-auto max-w-md">
      <TopAppBar
        title="My Profile"
        leading={
          <Link href="/household/settings" aria-label="Back to settings">
            <IconButton aria-label="Back to settings" variant="ghost">
              <ChevronLeft />
            </IconButton>
          </Link>
        }
      />
      <div className="px-4 py-6">
        <PersonalProfileForm
          initial={{
            display_name: profile.display_name,
            passport_number: profile.passport_number,
            passport_expiry: profile.passport_expiry,
            preferred_language: profile.preferred_language,
          }}
          action={savePersonalProfile}
          redirectTo="/household/settings"
          submitLabel="Save changes"
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. (`TopAppBar` accepts a `leading?: ReactNode` prop — verified in `src/components/ui/top-app-bar.tsx:4-5`.)

- [ ] **Step 3: Manual sanity check**

Run: `pnpm dev`
Visit `http://localhost:3000/household/settings/me`. Expected: form renders pre-filled with whatever the user previously saved (including blanks if optional fields are NULL). Submitting redirects to `/household/settings`, and a second visit shows the new values.

- [ ] **Step 4: Commit**

```bash
git add src/app/household/settings/me/page.tsx
git commit -m "feat(settings): add /household/settings/me personal profile edit page"
```

---

## Task 9: Wire the join-link redirect

**Files:**
- Modify: `src/app/join/[token]/page.tsx:32`

- [ ] **Step 1: Change the post-redeem redirect target**

Edit `src/app/join/[token]/page.tsx`. Replace:

```tsx
  redirect("/dashboard");
```

with:

```tsx
  // After redeem, route everyone (including owners who joined via link, in
  // theory) through the personal profile page. It self-skips if
  // onboarding_completed_at is already set, so this is safe for re-joiners.
  redirect("/onboarding/personal");
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Manual sanity check**

In one browser session, create a maid invite as an owner (visit `/household/settings`, generate invite, copy link). In an incognito session, sign in as a different Clerk user, paste the join link. Expected: after redeem, you land on `/onboarding/personal` (not `/dashboard`).

- [ ] **Step 4: Commit**

```bash
git add src/app/join/[token]/page.tsx
git commit -m "feat(join): route post-redeem to /onboarding/personal"
```

---

## Task 10: Dashboard maid-only gate

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Add the gate at the top of `DashboardPage`**

Edit `src/app/dashboard/page.tsx`. Find:

```tsx
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requireHousehold();
  const origin = await siteUrl();
  const sp = await searchParams;
```

Replace with:

```tsx
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requireHousehold();

  // Maid-only personal-profile gate. Owners and family members are NOT
  // redirected, even if their onboarding_completed_at is NULL — they can
  // optionally fill in their profile via Settings → My Profile.
  if (
    ctx.membership.role === "maid" &&
    ctx.profile.onboarding_completed_at == null
  ) {
    redirect("/onboarding/personal");
  }

  const origin = await siteUrl();
  const sp = await searchParams;
```

- [ ] **Step 2: Add the missing import**

In the same file, add `redirect` to the `next/navigation` import (or add the import if it's not yet present). Search the file for `from "next/navigation"`. If the import exists, append `redirect`. If it doesn't, add at the top:

```tsx
import { redirect } from "next/navigation";
```

- [ ] **Step 3: Confirm `ctx.profile` exposes `onboarding_completed_at`**

Run: `pnpm typecheck`
Expected: no errors. (`ctx.profile` is `Profile` from `@/lib/auth/current-profile`, which derives from `Database["public"]["Tables"]["profiles"]["Row"]` — extended in Task 2.)

If typecheck fails because `ctx.profile` is missing the new column, inspect `src/lib/auth/current-household.ts` to confirm it propagates the full profile row; the existing `getCurrentProfile()` already returns the full row, so the chain should be intact.

- [ ] **Step 4: Manual sanity check**

In an incognito session, sign in as a maid whose profile has `onboarding_completed_at IS NULL`. Visit `/dashboard` directly. Expected: bounce to `/onboarding/personal`. After completing the form, `/dashboard` renders normally.

In a separate session, sign in as an owner. Visit `/dashboard`. Expected: dashboard renders directly with no detour, regardless of the owner's `onboarding_completed_at` value.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(dashboard): redirect maids with NULL onboarding_completed_at to personal form"
```

---

## Task 11: Add "My Profile" link to household settings

**Files:**
- Modify: `src/app/household/settings/page.tsx`

- [ ] **Step 1: Inspect the existing settings page layout**

Read `src/app/household/settings/page.tsx`. Find where the existing "Household profile" section (from commit `7bb3f5c`) lives — it should be a `Card` with a `Link` to `/onboarding/profile?edit=1` or similar. The "My Profile" entry should follow the same visual pattern, placed adjacent.

- [ ] **Step 2: Add a "My Profile" card linking to the new edit page**

Insert a new card alongside the household-profile card. The exact location depends on the current layout; place it just above or below the household-profile card so the two related entries cluster together:

```tsx
<Card>
  <CardHeader>
    <CardTitle>My Profile</CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-sm text-text-muted">
      Your name, passport, and language preferences.
    </p>
    <Link
      href="/household/settings/me"
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3")}
    >
      Edit my profile
    </Link>
  </CardContent>
</Card>
```

If `buttonVariants` isn't already imported in the file, add `import { buttonVariants } from "@/components/ui/button";` at the top. `cn` is already imported (line 19 of the existing file).

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Manual sanity check**

Run: `pnpm dev`
Visit `/household/settings`. Expected: see a "My Profile" card next to the existing "Household profile" card. Clicking "Edit my profile" takes you to `/household/settings/me`.

- [ ] **Step 5: Commit**

```bash
git add src/app/household/settings/page.tsx
git commit -m "feat(settings): add My Profile card linking to personal profile edit"
```

---

## Task 12: E2E test — maid onboarding flow (Playwright)

**Files:**
- Create: `tests/e2e/maid-onboarding.spec.ts`

This task depends on the project's existing Playwright auth fixture. Before writing, run `ls tests/e2e/` and read one existing spec to learn the auth/setup pattern used by this project. If no Playwright setup exists for authenticated flows yet, **skip this task and document it as a deferred follow-up** in [docs/superpowers/specs/2026-05-17-design-system-foundation/follow-ups.md](../specs/2026-05-17-design-system-foundation/follow-ups.md) — manual sanity checks in Tasks 9–10 cover the happy path. Do not invent infrastructure.

- [ ] **Step 1: Inspect existing E2E setup**

Run: `ls tests/e2e/`
Read the first existing `.spec.ts` file to learn the auth fixture pattern.

- [ ] **Step 2a (if auth fixture exists): Write the E2E spec**

```ts
// tests/e2e/maid-onboarding.spec.ts
import { test, expect } from "@playwright/test";

test.describe("maid onboarding", () => {
  test("post-redeem maid lands on /onboarding/personal and continues to dashboard", async ({ page }) => {
    // Setup: assume the project's auth fixture has signed in as a maid whose
    // profile has onboarding_completed_at IS NULL and who has just redeemed
    // an invite. Adapt to the actual fixture API after reading existing specs.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding\/personal$/);

    // Name pre-filled, submit immediately.
    const name = page.locator('input[name="display_name"]');
    await expect(name).not.toBeEmpty();
    await page.getByRole("button", { name: /save & continue/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/);

    // Re-visit onboarding directly — should bounce back to dashboard.
    await page.goto("/onboarding/personal");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
```

- [ ] **Step 2b (if no auth fixture exists): Defer**

Append to [docs/superpowers/specs/2026-05-17-design-system-foundation/follow-ups.md](../specs/2026-05-17-design-system-foundation/follow-ups.md):

```markdown
- E2E coverage for maid onboarding flow (`/onboarding/personal` redirect from `/dashboard` and `/join/{token}`) — deferred until Playwright auth fixture exists.
```

Then skip to Step 5.

- [ ] **Step 3: Run the spec**

Run: `pnpm test:e2e -- tests/e2e/maid-onboarding.spec.ts`
Expected: PASS.

- [ ] **Step 4: If the test fails, adapt to the actual fixture API**

Re-read the existing spec carefully and align the test setup. Do not stub or skip — the value of this E2E is exercising the real redirect chain.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/maid-onboarding.spec.ts docs/superpowers/specs/2026-05-17-design-system-foundation/follow-ups.md
git commit -m "test(e2e): cover maid onboarding redirect flow (or defer if no auth fixture)"
```

---

## Task 13: Full verification pass

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass. New tests from Tasks 4 and 5 must be in the green.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Manual end-to-end smoke**

Run: `pnpm dev`

Smoke scenario 1 (new maid via invite):
1. As an owner, generate a maid invite at `/household/settings`.
2. In an incognito window, paste the join link; sign in via Clerk Google as a fresh account.
3. After login + redeem, expect to land on `/onboarding/personal` with name pre-filled.
4. Click "Save & continue" without filling optional fields.
5. Expect to land on `/dashboard`.
6. Navigate to `/household/settings/me`. Expect to see the same name and blank optional fields.
7. Fill in passport number, save. Expect to land on `/household/settings`. Re-visit `/household/settings/me` to confirm the value persists.

Smoke scenario 2 (existing maid pre-feature):
1. Manually `update public.profiles set onboarding_completed_at = null where id = '...maid...';` in psql.
2. Sign in as that maid, visit `/dashboard`.
3. Expect bounce to `/onboarding/personal`.

Smoke scenario 3 (owner is not affected):
1. As an owner with `onboarding_completed_at IS NULL`, visit `/dashboard`.
2. Expect the dashboard to render directly with no detour.

- [ ] **Step 5: Final commit (if any drift remains)**

If any unrelated edits accumulated, commit them with a clear message. Otherwise nothing to do.
