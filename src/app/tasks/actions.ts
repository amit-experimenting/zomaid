"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";
import type { Database } from "@/lib/db/types";

export type TaskActionResult<T> =
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
  if (val.frequency === "monthly" && (val.bymonthday === undefined)) {
    ctx.addIssue({ code: "custom", message: "monthly requires bymonthday" });
  }
  if (val.frequency === "monthly" && val.byweekday !== undefined) {
    ctx.addIssue({ code: "custom", message: "monthly must not set byweekday" });
  }
});

const CreateInput = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).nullable().optional(),
  assignedToProfileId: z.string().uuid().nullable().optional(),
  recurrence: RecurrenceSchema,
  dueTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).default("09:00:00"),
});

export async function createTask(input: z.infer<typeof CreateInput>): Promise<TaskActionResult<{ taskId: string }>> {
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
  }
  const ctx = await requireHousehold();
  const supabase = await createClient();

  const r = parsed.data.recurrence;
  const { data: row, error } = await supabase
    .from("tasks")
    .insert({
      household_id: ctx.household.id,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      assigned_to_profile_id: parsed.data.assignedToProfileId ?? null,
      recurrence_frequency: r.frequency,
      recurrence_interval: r.interval,
      recurrence_byweekday: r.byweekday ?? null,
      recurrence_bymonthday: r.bymonthday ?? null,
      recurrence_starts_on: r.startsOn ?? new Date().toISOString().slice(0, 10),
      recurrence_ends_on: r.endsOn ?? null,
      due_time: parsed.data.dueTime.length === 5 ? `${parsed.data.dueTime}:00` : parsed.data.dueTime,
      created_by_profile_id: ctx.profile.id,
    })
    .select("id")
    .single();
  if (error || !row) {
    return { ok: false, error: { code: "TASK_FORBIDDEN", message: error?.message ?? "Insert failed" } };
  }

  // Immediately materialize next 7 days for this and other tasks.
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 7);
  await supabase.rpc("tasks_generate_occurrences", { p_horizon_date: horizon.toISOString().slice(0, 10) });

  revalidatePath("/tasks");
  return { ok: true, data: { taskId: row.id } };
}

const UpdateInput = CreateInput.partial().extend({ taskId: z.string().uuid() });

export async function updateTask(input: z.infer<typeof UpdateInput>): Promise<TaskActionResult<{ taskId: string }>> {
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
  }
  await requireHousehold();
  const supabase = await createClient();

  const patch: Database["public"]["Tables"]["tasks"]["Update"] = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes ?? null;
  if (parsed.data.assignedToProfileId !== undefined) patch.assigned_to_profile_id = parsed.data.assignedToProfileId ?? null;
  if (parsed.data.dueTime !== undefined) {
    patch.due_time = parsed.data.dueTime.length === 5 ? `${parsed.data.dueTime}:00` : parsed.data.dueTime;
  }
  let recurrenceChanged = false;
  if (parsed.data.recurrence !== undefined) {
    const r = parsed.data.recurrence;
    patch.recurrence_frequency = r.frequency;
    patch.recurrence_interval = r.interval;
    patch.recurrence_byweekday = r.byweekday ?? null;
    patch.recurrence_bymonthday = r.bymonthday ?? null;
    patch.recurrence_starts_on = r.startsOn ?? undefined;
    patch.recurrence_ends_on = r.endsOn ?? null;
    recurrenceChanged = true;
  }

  const { error } = await supabase.from("tasks").update(patch).eq("id", parsed.data.taskId);
  if (error) return { ok: false, error: { code: "TASK_FORBIDDEN", message: error.message } };

  // If recurrence changed, delete future pending occurrences and re-materialize.
  if (recurrenceChanged) {
    await supabase
      .from("task_occurrences")
      .delete()
      .eq("task_id", parsed.data.taskId)
      .eq("status", "pending")
      .gt("due_at", new Date().toISOString());
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 7);
    await supabase.rpc("tasks_generate_occurrences", { p_horizon_date: horizon.toISOString().slice(0, 10) });
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/edit/${parsed.data.taskId}`);
  return { ok: true, data: { taskId: parsed.data.taskId } };
}

export async function markOccurrenceDone(input: { occurrenceId: string }): Promise<TaskActionResult<{ occurrenceId: string }>> {
  const parsed = z.object({ occurrenceId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input" } };
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("task_occurrences")
    .update({ status: "done", completed_by_profile_id: ctx.profile.id, completed_at: new Date().toISOString() })
    .eq("id", parsed.data.occurrenceId)
    .eq("status", "pending");
  if (error) return { ok: false, error: { code: "TASK_FORBIDDEN", message: error.message } };
  revalidatePath("/tasks");
  return { ok: true, data: { occurrenceId: parsed.data.occurrenceId } };
}

export async function markOccurrenceSkipped(input: { occurrenceId: string }): Promise<TaskActionResult<{ occurrenceId: string }>> {
  const parsed = z.object({ occurrenceId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input" } };
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("task_occurrences")
    .update({ status: "skipped", completed_by_profile_id: ctx.profile.id, completed_at: new Date().toISOString() })
    .eq("id", parsed.data.occurrenceId)
    .eq("status", "pending");
  if (error) return { ok: false, error: { code: "TASK_FORBIDDEN", message: error.message } };
  revalidatePath("/tasks");
  return { ok: true, data: { occurrenceId: parsed.data.occurrenceId } };
}

/**
 * Mark a standard task as not applicable for the caller's household.
 * Adds a row to household_task_hides; the next generation cycle skips it
 * for this household. Any *existing* unresolved occurrences for this household
 * × task are also deleted so they disappear from /tasks immediately.
 */
export async function hideStandardTask(input: { taskId: string }): Promise<TaskActionResult<{ taskId: string }>> {
  const parsed = z.object({ taskId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input" } };
  const ctx = await requireHousehold();
  const supabase = await createClient();

  const { error: hideErr } = await supabase.from("household_task_hides").insert({
    household_id: ctx.household.id,
    task_id: parsed.data.taskId,
    hidden_by_profile_id: ctx.profile.id,
  });
  if (hideErr) return { ok: false, error: { code: "TASK_FORBIDDEN", message: hideErr.message } };

  // Drop existing pending occurrences for this household × task.
  await supabase
    .from("task_occurrences")
    .delete()
    .eq("household_id", ctx.household.id)
    .eq("task_id", parsed.data.taskId)
    .eq("status", "pending");

  revalidatePath("/tasks");
  return { ok: true, data: { taskId: parsed.data.taskId } };
}

export async function unhideStandardTask(input: { taskId: string }): Promise<TaskActionResult<{ taskId: string }>> {
  const parsed = z.object({ taskId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input" } };
  const ctx = await requireHousehold();
  const supabase = await createClient();

  const { error } = await supabase
    .from("household_task_hides")
    .delete()
    .eq("household_id", ctx.household.id)
    .eq("task_id", parsed.data.taskId);
  if (error) return { ok: false, error: { code: "TASK_FORBIDDEN", message: error.message } };

  // Re-materialise the next 7 days of occurrences so it shows up immediately.
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 7);
  await supabase.rpc("tasks_generate_occurrences", { p_horizon_date: horizon.toISOString().slice(0, 10) });

  revalidatePath("/tasks");
  return { ok: true, data: { taskId: parsed.data.taskId } };
}
