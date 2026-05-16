import { redirect } from "next/navigation";

/**
 * `/plan` used to be the meal-plan landing page. The per-day meal-plan view
 * now lives at `/recipes` (the renamed "Meal" tab in the main nav). This
 * redirect preserves old bookmarks / push-notification deep links.
 */
export default function PlanIndex() {
  redirect("/recipes");
}
