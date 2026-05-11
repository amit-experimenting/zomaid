"use client";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";
import type { Database } from "@/lib/db/types";

/**
 * Browser-side Supabase client that forwards the Clerk session JWT via the
 * `accessToken` callback. Clerk owns the auth session entirely; we use the
 * plain `@supabase/supabase-js` client (not `@supabase/ssr`) because the
 * SSR helpers disallow combining `accessToken` with their cookie storage.
 */
export function useSupabaseClient() {
  const { getToken } = useAuth();
  return useMemo(
    () =>
      createSupabaseClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          accessToken: async () =>
            (await getToken({ template: "supabase" })) ?? null,
        },
      ),
    [getToken],
  );
}
