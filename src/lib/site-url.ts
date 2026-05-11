import "server-only";
import { headers } from "next/headers";

/**
 * Returns the fully-qualified site URL (scheme + host) of the current request.
 * Works for both dev (http://localhost:3000) and prod (https://your-domain.com)
 * without needing an env var, by reading the request headers Vercel forwards.
 *
 * Example: `${await siteUrl()}/join/<token>` →
 *   dev:  http://localhost:3000/join/abc
 *   prod: https://zomaid.app/join/abc
 */
export async function siteUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
