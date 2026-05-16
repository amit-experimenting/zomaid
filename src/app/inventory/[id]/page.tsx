import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";
import { InventoryAdjustForm } from "@/components/inventory/adjust-form";
import { InventoryTransactionLog } from "@/components/inventory/transaction-log";

export default async function InventoryItemDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("inventory_items")
    .select("id,item_name,quantity,unit,low_stock_threshold,notes,household_id")
    .eq("id", id)
    .maybeSingle();
  if (!item || item.household_id !== ctx.household.id) notFound();

  const { data: txs } = await supabase
    .from("inventory_transactions")
    .select("id,delta,unit,reason,notes,created_at")
    .eq("inventory_item_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const canWrite = ctx.membership.role === "owner" || ctx.membership.role === "maid";

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="inventory" />
      <div className="px-4 pt-3">
        <Link href="/inventory" className="text-xs text-muted-foreground hover:text-foreground">
          ← Inventory
        </Link>
      </div>
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">{item.item_name}</h1>
        <div className="text-sm text-muted-foreground">
          {item.quantity} {item.unit}
          {item.low_stock_threshold !== null && Number(item.quantity) <= Number(item.low_stock_threshold) && (
            <span
              className="ml-2 rounded bg-yellow-100 px-1.5 py-0.5 uppercase text-yellow-800"
              style={{ fontSize: 10 }}
            >
              Low
            </span>
          )}
        </div>
      </header>
      {canWrite && (
        <div className="px-4 py-2">
          <InventoryAdjustForm itemId={id} />
        </div>
      )}
      <section className="px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h2>
        <InventoryTransactionLog
          entries={(txs ?? []).map((t) => ({
            id: t.id,
            delta: Number(t.delta),
            unit: t.unit,
            reason: t.reason as
              | "onboarding"
              | "manual_adjust"
              | "cook_deduct"
              | "bill_ingest"
              | "undo",
            notes: t.notes,
            created_at: t.created_at,
          }))}
        />
      </section>
    </main>
  );
}
