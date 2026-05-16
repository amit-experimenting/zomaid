import { notFound } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";
import { TaskForm } from "@/components/tasks/task-form";

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();
  const { data: members } = await supabase
    .from("household_memberships")
    .select("profile_id, profiles!inner(id, display_name)")
    .eq("household_id", ctx.household.id)
    .eq("status", "active")
    .overrideTypes<Array<{ profile_id: string; profiles: { id: string; display_name: string } }>>();
  const memberList = (members ?? []).map((m) => ({
    id: m.profiles.id,
    display_name: m.profiles.display_name,
  }));
  return (
    <main className="mx-auto max-w-md">
      <MainNav active="tasks" />
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Edit task</h1>
      </header>
      <TaskForm
        mode="edit"
        taskId={id}
        members={memberList}
        initial={{
          title: task.title,
          notes: task.notes,
          assignedToProfileId: task.assigned_to_profile_id,
          recurrence: {
            // Round-trip the UI-only one-off flag: daily/interval=1 with
            // identical start+end dates was created by the one-off form path.
            mode:
              task.recurrence_frequency === "daily"
              && task.recurrence_interval === 1
              && task.recurrence_ends_on != null
              && task.recurrence_ends_on === task.recurrence_starts_on
                ? "one_off"
                : task.recurrence_frequency,
            interval: task.recurrence_interval,
            byweekday: task.recurrence_byweekday ?? [],
            bymonthday: task.recurrence_bymonthday,
            startsOn: task.recurrence_starts_on,
            endsOn: task.recurrence_ends_on,
            dueTime: task.due_time,
          },
        }}
      />
    </main>
  );
}
