"use client";
import { useState, useTransition } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { hideStandardTask, markOccurrenceDone, markOccurrenceSkipped } from "@/app/tasks/actions";

export type OccurrenceActionSheetProps = {
  occurrenceId: string;
  taskId: string;
  title: string;
  /** True if this task is a system-wide standard task (household_id IS NULL). */
  isStandard: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OccurrenceActionSheet(p: OccurrenceActionSheetProps) {
  const [pending, start] = useTransition();
  const [confirmHide, setConfirmHide] = useState(false);

  const done = () => start(async () => { await markOccurrenceDone({ occurrenceId: p.occurrenceId }); p.onOpenChange(false); });
  const skip = () => start(async () => { await markOccurrenceSkipped({ occurrenceId: p.occurrenceId }); p.onOpenChange(false); });
  const hide = () => start(async () => { await hideStandardTask({ taskId: p.taskId }); p.onOpenChange(false); });

  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader><SheetTitle>{p.title}</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-2 py-4">
          <Button type="button" onClick={done} loading={pending}>Mark done</Button>
          <Button type="button" variant="secondary" onClick={skip} loading={pending}>Skip</Button>
          {p.isStandard ? (
            confirmHide ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <p className="text-sm">
                  Hide this standard task for your household? All upcoming occurrences will be removed.
                  You can re-enable it from <code>/admin/tasks</code> later.
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" className="flex-1" disabled={pending} onClick={() => setConfirmHide(false)}>Cancel</Button>
                  <Button type="button" variant="destructive" className="flex-1" loading={pending} onClick={hide}>Hide</Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirmHide(true)}>
                Not applicable for our household
              </Button>
            )
          ) : (
            <Button type="button" variant="ghost" render={<Link href={`/tasks/edit/${p.taskId}`} />}>
              Edit task
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
