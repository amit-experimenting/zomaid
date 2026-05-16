import { redirect } from "next/navigation";

/**
 * `/tasks/[date]` used to be the per-day tasks view. It now redirects to
 * the unified Day view on `/dashboard` with the tasks tab pre-selected.
 * Invalid dates fall through to today on the dashboard (validated
 * server-side).
 */
export default async function TasksByDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  redirect(`/dashboard?view=tasks&date=${encodeURIComponent(date)}`);
}
