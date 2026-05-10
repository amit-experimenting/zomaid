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

/** Service-role client. Bypasses RLS. Server-only; never expose to anon callers. */
export function createServiceClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    },
  );
}
