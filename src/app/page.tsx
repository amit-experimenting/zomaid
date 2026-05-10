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
