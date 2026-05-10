import { currentUser } from "@clerk/nextjs/server";

export default async function DashboardPage() {
  const user = await currentUser();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user?.emailAddresses[0]?.emailAddress ?? user?.id}
      </p>
    </main>
  );
}
