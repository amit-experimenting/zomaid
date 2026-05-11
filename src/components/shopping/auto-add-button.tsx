"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { autoAddFromPlans } from "@/app/shopping/actions";

export function AutoAddButton() {
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const onClick = () => {
    start(async () => {
      const res = await autoAddFromPlans();
      if (!res.ok) { setToast(res.error.message); return; }
      if (res.data.insertedCount === 0) {
        setToast("Nothing new to add from this week's plans.");
      } else {
        setToast(`Added ${res.data.insertedCount} item${res.data.insertedCount === 1 ? "" : "s"} from this week's plans.`);
      }
      setTimeout(() => setToast(null), 4000);
    });
  };
  return (
    <>
      <Button type="button" onClick={onClick} disabled={pending} size="sm">
        {pending ? "Pulling…" : "+ Auto-add 7d"}
      </Button>
      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow">
          {toast}
        </div>
      )}
    </>
  );
}
