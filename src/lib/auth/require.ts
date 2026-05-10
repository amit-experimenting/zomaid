import "server-only";
import { redirect } from "next/navigation";
import {
  getCurrentHousehold,
  type CurrentHousehold,
} from "./current-household";
import type { Privilege, Role } from "@/lib/db/types";

export async function requireHousehold(): Promise<CurrentHousehold> {
  const ctx = await getCurrentHousehold();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

export async function requireRole(role: Role): Promise<CurrentHousehold> {
  const ctx = await requireHousehold();
  if (ctx.membership.role !== role) redirect("/dashboard");
  return ctx;
}

export async function requirePrivilege(min: Privilege): Promise<CurrentHousehold> {
  const ctx = await requireHousehold();
  const order: Record<Privilege, number> = { view_only: 0, meal_modify: 1, full: 2 };
  if (order[ctx.membership.privilege] < order[min]) redirect("/dashboard");
  return ctx;
}
