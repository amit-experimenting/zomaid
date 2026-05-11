"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";

export type AdminTaskResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string> } };

const FrequencySchema = z.enum(["daily", "weekly", "monthly"]);

const RecurrenceSchema = z.object({
  frequency: FrequencySchema,
  interval: z.number().int().positive().max(365).default(1),
  byweekday: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  bymonthday: z.number().int().min(1).max(31).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).superRefine((val, ctx) => {
  if (val.frequency === "daily" && (val.byweekday || val.bymonthday !== undefined)) {
    ctx.addIssue({ code: "custom", message: "daily must not set byweekday or bymonthday" });
  }
  if (val.frequency === "weekly" && (!val.byweekday || val.byweekday.length === 0)) {
    ctx.addIssue({ code: "custom", message: "weekly requires at least one byweekday" });
  }
  if (val.frequency === "weekly" && val.bymonthday !== undefined) {
    ctx.addIssue({ code: "custom", message: "weekly must not set bymonthday" });
  }
  if (val.frequency === "monthly" && val.bymonthday === undefined) {
    ctx.addIssue({ code: "custom", message: "monthly requires bymonthday" });
  }
  if (val.frequency === "monthly" && val.byweekday !== undefined) {
    ctx.addIssue({ code: "custom", message: "monthly must not set byweekday" });
  }
});

const CreateInput = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).nullable().optional(),
  recurrence: RecurrenceSchema,
  dueTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).default("09:00:00"),
});

/**
 * Insert a system-wide standard task (household_id IS NULL). Uses the
 * service-role client because the standard-task RLS lets only service_role
 * write rows where household_id IS NULL.
 */
export async function createStandardTask(input: z.infer<typeof CreateInput>): Promise<AdminTaskResult<{ taskId: string }>> {
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "ADMIN_TASK_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
  }
  await requireAdmin();
  const supabase = createServiceClient();
  const r = parsed.data.recurrence;
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      household_id: null,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      recurrence_frequency: r.frequency,
      recurrence_interval: r.interval,
      recurrence_byweekday: r.byweekday ?? null,
      recurrence_bymonthday: r.bymonthday ?? null,
      recurrence_starts_on: r.startsOn ?? new Date().toISOString().slice(0, 10),
      recurrence_ends_on: r.endsOn ?? null,
      due_time: parsed.data.dueTime.length === 5 ? `${parsed.data.dueTime}:00` : parsed.data.dueTime,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: { code: "ADMIN_TASK_FORBIDDEN", message: error?.message ?? "Insert failed" } };
  revalidatePath("/admin/tasks");
  revalidatePath("/tasks");
  return { ok: true, data: { taskId: data.id } };
}

export async function archiveStandardTask(input: { taskId: string }): Promise<AdminTaskResult<{ taskId: string }>> {
  const parsed = z.object({ taskId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "ADMIN_TASK_INVALID", message: "Invalid input" } };
  await requireAdmin();
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.taskId)
    .is("household_id", null);
  if (error) return { ok: false, error: { code: "ADMIN_TASK_FORBIDDEN", message: error.message } };
  // Drop future pending occurrences across all households.
  await supabase
    .from("task_occurrences")
    .delete()
    .eq("task_id", parsed.data.taskId)
    .eq("status", "pending")
    .gt("due_at", new Date().toISOString());
  revalidatePath("/admin/tasks");
  revalidatePath("/tasks");
  return { ok: true, data: { taskId: parsed.data.taskId } };
}
