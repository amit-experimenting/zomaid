import { redirect } from "next/navigation";

export default function PlanIndex() {
  const today = new Date().toISOString().slice(0, 10);
  redirect(`/plan/${today}`);
}
