import { StatusBadge, type BillStatus } from "./status-badge";

export type BillDetailHeaderProps = {
  status: BillStatus;
  statusReason: string | null;
  storeName: string | null;
  billDate: string | null;
  totalAmount: number | null;
  currency: string;
};

export function BillDetailHeader(p: BillDetailHeaderProps) {
  return (
    <header className="border-b border-border px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{p.storeName ?? "Awaiting OCR…"}</h1>
        <StatusBadge status={p.status} />
      </div>
      <div className="text-sm text-muted-foreground">
        {p.billDate ?? "—"}
        {p.totalAmount !== null ? ` · ${p.currency} ${p.totalAmount.toFixed(2)}` : ""}
      </div>
      {p.statusReason && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {p.statusReason}
        </p>
      )}
    </header>
  );
}
