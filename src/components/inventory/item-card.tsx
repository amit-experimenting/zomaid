import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export type InventoryItemCardProps = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number | null;
};

export function InventoryItemCard({ id, name, quantity, unit, lowStockThreshold }: InventoryItemCardProps) {
  const low = lowStockThreshold !== null && quantity <= lowStockThreshold;
  return (
    <Link href={`/inventory/${id}`}>
      <Card className="hover:bg-muted/50">
        <CardContent className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{name}</div>
            <div className="text-xs text-muted-foreground">
              {quantity} {unit}
            </div>
          </div>
          {low && (
            <div className="rounded-sm bg-yellow-100 px-1.5 py-0.5 text-[10px] uppercase text-yellow-800">Low</div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
