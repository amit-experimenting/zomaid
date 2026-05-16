import { redirect } from "next/navigation";

/**
 * `/plan` used to be the meal-plan landing page. The Day view on
 * `/dashboard` now hosts both tasks and meal plan in one place. This
 * redirect preserves old bookmarks / push-notification deep links.
 */
export default function PlanIndex() {
  redirect("/dashboard?view=meal");
}
