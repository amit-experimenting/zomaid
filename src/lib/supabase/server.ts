import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import type { Database } from "@/lib/db/types";

/**
 * Server-side Supabase client that forwards the Clerk session JWT via the
 * `accessToken` callback. RLS policies use `auth.jwt() ->> 'sub'` to identify
 * the caller. There are no Supabase Auth cookies to manage — Clerk owns
 * the session entirely — so we use the plain `@supabase/supabase-js` client
 * rather than `@supabase/ssr` (newer ssr versions disallow combining
 * `accessToken` with cookie storage).
 */
export async function createClient() {
  const { getToken } = await auth();

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: async () => (await getToken({ template: "supabase" })) ?? null,
    },
  );
}

/** Service-role client. Bypasses RLS. Server-only; never expose to anon callers. */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}
