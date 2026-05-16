import { redirect } from "next/navigation";

/**
 * `/tasks` used to be the tasks index. The Day view on `/dashboard` now
 * hosts the single merged tasks-plus-meals feed. This redirect preserves
 * old bookmarks / push-notification deep links.
 */
export default function TasksIndex() {
  redirect("/dashboard");
}
