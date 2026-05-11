import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const ctx = await requireHousehold();

  let pendingOwnerInviteToken: string | null = null;
  if (ctx.membership.role === "maid") {
    const supabase = await createClient();
    const r = await supabase
      .from("invites")
      .select("token")
      .eq("household_id", ctx.household.id)
      .eq("intended_role", "owner")
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (r.error) throw new Error(r.error.message);
    pendingOwnerInviteToken = r.data?.[0]?.token ?? null;
  }

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

      {pendingOwnerInviteToken ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Share this link with your owner</CardTitle>
            <CardDescription>One-time link, expires in 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded-md bg-muted p-3 text-xs">
              {`/join/${pendingOwnerInviteToken}`}
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
