import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";
import { TaskForm } from "@/components/tasks/task-form";

export default async function NewTaskPage() {
  const ctx = await requireHousehold();
  const supabase = await createClient();
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
      <MainNav active="home" />
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">New task</h1>
      </header>
      <TaskForm mode="create" members={memberList} />
    </main>
  );
}
