"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { generatePlanForDate } from "@/app/plan/actions";

export function MissingPlanCTA({ planDate }: { planDate: string }) {
  const [pending, start] = useTransition();
  const onGenerate = () => {
    start(async () => { await generatePlanForDate({ planDate }); });
  };
  return (
    <div className="flex justify-center px-4 py-4">
      <Button onClick={onGenerate} disabled={pending} variant="outline">
        {pending ? "Generating…" : "Generate plan for this day"}
      </Button>
    </div>
  );
}
