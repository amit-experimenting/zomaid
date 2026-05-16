import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function OnboardingPage() {
  if (await getCurrentHousehold()) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome to Zomaid</h1>
      <p className="mt-2 text-sm text-muted-foreground sm:text-base">
        How would you like to get started?
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>I&apos;m an FDW</CardTitle>
            <CardDescription>Free. Add your owner&apos;s details to begin.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/onboarding/maid" className={cn(buttonVariants(), "w-full")}>
              Continue
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>I&apos;m an owner</CardTitle>
            <CardDescription>Start a household and invite your FDW + family.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/onboarding/owner" className={cn(buttonVariants(), "w-full")}>
              Continue
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>I have an invite</CardTitle>
            <CardDescription>Got a 6-digit code or a link.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/join/code" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
              Enter code
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
