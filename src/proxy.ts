import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/join/(.*)",
  "/api/webhooks/(.*)",
  "/api/cron/(.*)",
]);

const isAuthGated = createRouteMatcher([
  "/dashboard(.*)",
  "/household(.*)",
  "/inventory(.*)",
  "/onboarding(.*)",
  "/recipes(.*)",
  "/shopping(.*)",
  "/bills(.*)",
  "/tasks(.*)",
  "/admin(.*)",
  "/scans(.*)",
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
