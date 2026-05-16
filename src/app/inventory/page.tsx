import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";
import { PendingScansBanner } from "@/components/site/pending-scans-banner";
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
      <PendingScansBanner />
      <header className="flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-semibold">Inventory</h1>
        <Link
          href="/inventory/conversions"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          Unit conversions
        </Link>
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
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-right font-medium">Qty</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((i) => {
              const qty = Number(i.quantity);
              const threshold = i.low_stock_threshold === null ? null : Number(i.low_stock_threshold);
              const isLow = threshold !== null && qty <= threshold;
              return (
                <tr key={i.id} className="border-b border-border hover:bg-muted/40">
                  <td className="px-4 py-2">
                    <Link href={`/inventory/${i.id}`} className="block">
                      <span className="font-medium">{i.item_name}</span>
                      {isLow && (
                        <span
                          className="ml-2 rounded bg-yellow-100 px-1.5 py-0.5 uppercase text-yellow-800"
                          style={{ fontSize: 10 }}
                        >
                          Low
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <Link href={`/inventory/${i.id}`} className="block">
                      {qty} {i.unit}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
