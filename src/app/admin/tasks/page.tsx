import { requireAdmin } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/server";
import { AdminTasksClient } from "./_client";

export default async function AdminTasksPage() {
  await requireAdmin();
  const supabase = createServiceClient();
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, notes, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, recurrence_starts_on, recurrence_ends_on, due_time, archived_at")
    .is("household_id", null)
    .order("title", { ascending: true });

  return (
    <main className="mx-auto max-w-md">
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Admin · Standard tasks</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          System-wide tasks visible to every household. Households can mark any as &ldquo;not applicable&rdquo;.
        </p>
      </header>
      <AdminTasksClient tasks={tasks ?? []} />
    </main>
  );
}
