"use client";
import { useTransition } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { markOccurrenceDone, markOccurrenceSkipped } from "@/app/tasks/actions";

export type OccurrenceActionSheetProps = {
  occurrenceId: string;
  taskId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OccurrenceActionSheet(p: OccurrenceActionSheetProps) {
  const [pending, start] = useTransition();
  const done = () => start(async () => { await markOccurrenceDone({ occurrenceId: p.occurrenceId }); p.onOpenChange(false); });
  const skip = () => start(async () => { await markOccurrenceSkipped({ occurrenceId: p.occurrenceId }); p.onOpenChange(false); });
  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader><SheetTitle>{p.title}</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-2 py-4">
          <Button type="button" onClick={done} disabled={pending}>Mark done</Button>
          <Button type="button" variant="outline" onClick={skip} disabled={pending}>Skip</Button>
          <Button type="button" variant="ghost" render={<Link href={`/tasks/${p.taskId}/edit`} />}>
            Edit task
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
