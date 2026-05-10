import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SearchParams = Promise<{ ownerInvite?: string }>;

export default async function DashboardPage({
  searchParams,
}: { searchParams: SearchParams }) {
  const ctx = await requireHousehold();
  const sp = await searchParams;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{ctx.household.name}</h1>
          <p className="text-sm text-muted-foreground">
            You are signed in as <strong>{ctx.profile.display_name}</strong> ({ctx.membership.role}).
          </p>
        </div>
        <Link href="/household/settings" className={cn(buttonVariants({ variant: "outline" }))}>
          Settings
        </Link>
      </div>

      {sp.ownerInvite ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Share this link with your owner</CardTitle>
            <CardDescription>One-time link, expires in 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-md bg-muted p-3 text-xs">
              {`/join/${sp.ownerInvite}`}
            </code>
          </CardContent>
        </Card>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-medium">Coming soon</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            ["Recipes & meal plan", "Plan today's breakfast, lunch, dinner."],
            ["Inventory & bills", "Scan grocery bills, track items."],
            ["Fridge", "Track what's inside, when it expires."],
            ["Tasks", "Recurring household tasks with reminders."],
          ].map(([title, desc]) => (
            <Card key={title} aria-disabled className="opacity-60">
              <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button disabled variant="outline" className="w-full">Soon</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
