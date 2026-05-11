import { cn } from "@/lib/utils";

export type BillStatus = "pending" | "processing" | "processed" | "failed";

const LABEL: Record<BillStatus, string> = {
  pending: "Pending",
  processing: "Processing",
  processed: "Processed",
  failed: "Failed",
};

const CLS: Record<BillStatus, string> = {
  pending:    "bg-muted text-muted-foreground",
  processing: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  processed:  "bg-green-500/15 text-green-400 border-green-500/30",
  failed:     "bg-red-500/15 text-red-400 border-red-500/30",
};

export function StatusBadge({ status }: { status: BillStatus }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium", CLS[status])}>
      {LABEL[status]}
    </span>
  );
}
