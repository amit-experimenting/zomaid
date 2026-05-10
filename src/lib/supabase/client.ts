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
