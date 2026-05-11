"use client";
import { cn } from "@/lib/utils";

export type OccurrenceRowItem = {
  occurrenceId: string;
  taskId: string;
  title: string;
  dueAt: string;
  assigneeName: string | null;
  status: "pending" | "done" | "skipped";
  /** True when the underlying task is a system-wide standard task. */
  isStandard: boolean;
};

export function OccurrenceRow({
  item, readOnly, onTap,
}: { item: OccurrenceRowItem; readOnly: boolean; onTap: () => void }) {
  const due = new Date(item.dueAt);
  const isOverdue = item.status === "pending" && due.getTime() < Date.now();
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={readOnly}
      className={cn(
        "flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left",
        !readOnly && "hover:bg-muted/50",
        item.status !== "pending" && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn("truncate font-medium", item.status === "done" && "line-through")}>
          {item.title}
        </div>
        <div className="text-xs text-muted-foreground">
          {due.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
          {item.assigneeName ? ` · ${item.assigneeName}` : ""}
          {isOverdue ? " · overdue" : ""}
        </div>
      </div>
      <span className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        item.status === "pending" && (isOverdue ? "bg-red-500/15 text-red-400" : "bg-blue-500/15 text-blue-400"),
        item.status === "done" && "bg-green-500/15 text-green-400",
        item.status === "skipped" && "bg-muted text-muted-foreground",
      )}>
        {item.status}
      </span>
    </button>
  );
}
