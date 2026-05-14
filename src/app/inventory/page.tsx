import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";
import { InventoryItemCard } from "@/components/inventory/item-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function InventoryListPage() {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("inventory_items")
    .select("id,item_name,quantity,unit,low_stock_threshold")
    .eq("household_id", ctx.household.id)
    .order("item_name", { ascending: true });
  if (error) throw new Error(error.message);

  const canWrite = ctx.membership.role === "owner" || ctx.membership.role === "maid";

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="inventory" />
      <header className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Inventory</h1>
        {canWrite && (
          <Link href="/inventory/new" className={cn(buttonVariants({ size: "sm" }))}>
            Add item
          </Link>
        )}
      </header>
      {items?.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">Your inventory is empty.</p>
          {canWrite && (
            <Link href="/inventory/new" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
              Add your first item →
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-4 py-2">
          {items?.map((i) => (
            <InventoryItemCard
              key={i.id}
              id={i.id}
              name={i.item_name}
              quantity={Number(i.quantity)}
              unit={i.unit}
              lowStockThreshold={i.low_stock_threshold === null ? null : Number(i.low_stock_threshold)}
            />
          ))}
        </div>
      )}
      <div className="px-4 py-3">
        <Link href="/inventory/conversions" className="text-sm text-muted-foreground underline">Unit conversions</Link>
      </div>
    </main>
  );
}
