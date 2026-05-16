import { redirect } from "next/navigation";

/**
 * `/plan/[date]` used to be the per-day meal-plan view. The meal-plan view
 * now lives at `/recipes?date=…`. Invalid dates fall through to today on
 * `/recipes` (validated server-side).
 */
export default async function PlanForDate({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  redirect(`/recipes?date=${encodeURIComponent(date)}`);
}
