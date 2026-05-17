import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { Button } from "@/components/ui/button";

export default async function Home() {
  // Server-side: signed-in users are redirected away before this page renders.
  // Clerk's <Show when="signed-out"> additionally guards the SignInButton's
  // modal from mounting if the client briefly sees the signed-in state during
  // a Clerk session refresh (e.g., right after a successful modal close).
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
          {/* Redirect mode (default). Buttons navigate to /sign-in and
              /sign-up — Clerk catch-all routes under
              src/app/sign-in/[[...sign-in]] and
              src/app/sign-up/[[...sign-up]] render <SignIn /> / <SignUp />
              there. After auth, Clerk redirects to /dashboard per the
              CLERK_SIGN_IN_FALLBACK_REDIRECT_URL env var. */}
          <SignInButton><Button>Sign in</Button></SignInButton>
          <SignUpButton><Button variant="secondary">Sign up</Button></SignUpButton>
        </Show>
        <Show when="signed-in">
          <p className="text-xs text-muted-foreground">Redirecting…</p>
        </Show>
      </div>
    </main>
  );
}
