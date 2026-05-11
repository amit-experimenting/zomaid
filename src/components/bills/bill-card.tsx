import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, type BillStatus } from "./status-badge";

export type BillCardProps = {
  id: string;
  status: BillStatus;
  storeName: string | null;
  billDate: string | null;
  totalAmount: number | null;
  currency: string;
  createdAt: string;
};

export function BillCard(p: BillCardProps) {
  return (
    <Link href={`/bills/${p.id}`}>
      <Card className="hover:bg-muted/50">
        <CardContent className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{p.storeName ?? "Awaiting OCR…"}</div>
            <div className="text-xs text-muted-foreground">
              {p.billDate ?? "—"}
              {p.totalAmount !== null ? ` · ${p.currency} ${p.totalAmount.toFixed(2)}` : ""}
              {` · uploaded ${new Date(p.createdAt).toLocaleDateString("en-SG")}`}
            </div>
          </div>
          <StatusBadge status={p.status} />
        </CardContent>
      </Card>
    </Link>
  );
}
