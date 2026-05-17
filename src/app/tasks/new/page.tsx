import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { IconButton } from "@/components/ui/icon-button";
import { TopAppBar } from "@/components/ui/top-app-bar";
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
      <TopAppBar
        title="New task"
        leading={
          <IconButton variant="ghost" aria-label="Back" render={<Link href="/dashboard" />}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <TaskForm mode="create" members={memberList} />
    </main>
  );
}
