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
