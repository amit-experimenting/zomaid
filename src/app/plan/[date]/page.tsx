import { redirect } from "next/navigation";

/**
 * `/plan/[date]` used to be the per-day meal-plan view. It now redirects
 * to the unified Day view on `/dashboard` with the meal tab pre-selected.
 * Invalid dates fall through to today on the dashboard (validated server-side).
 */
export default async function PlanForDate({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  redirect(`/dashboard?view=meal&date=${encodeURIComponent(date)}`);
}
