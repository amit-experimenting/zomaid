import { redirect } from "next/navigation";

/**
 * `/tasks` used to be the tasks index. The Day view on `/dashboard` now
 * hosts both tasks and meal plan in one place. This redirect preserves old
 * bookmarks / push-notification deep links.
 */
export default function TasksIndex() {
  redirect("/dashboard?view=tasks");
}
