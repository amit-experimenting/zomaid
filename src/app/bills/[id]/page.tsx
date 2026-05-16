import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { IconButton } from "@/components/ui/icon-button";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { BillDetailHeader } from "@/components/bills/bill-detail-header";
import { BillDetailActions } from "@/components/bills/_detail-actions";
import { BillImageViewer } from "@/components/bills/bill-image-viewer";
import { InventoryReviewQueue, type LineRow, type ExistingInvOption } from "./_inventory-queue";

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("bills")
    .select("id, household_id, status, status_reason, store_name, bill_date, total_amount, currency, image_storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!bill) notFound();

  const { data: lines } = await supabase
    .from("bill_line_items")
    .select("id, position, item_name, quantity, unit, unit_price, line_total, matched_shopping_item_id, shopping_list_items!matched_shopping_item_id(item_name)")
    .eq("bill_id", id)
    .order("position");

  // PostgREST embed shape (shopping_list_items) isn't captured by the generated
  // types, so we narrow it locally rather than reach for `any`.
  type LineRowFromDb = {
    id: string;
    position: number;
    item_name: string;
    quantity: number | string | null;
    unit: string | null;
    unit_price: number | string | null;
    line_total: number | string | null;
    shopping_list_items:
      | { item_name: string }
      | { item_name: string }[]
      | null;
  };
  const items = ((lines ?? []) as unknown as LineRowFromDb[]).map((l) => ({
    id: l.id,
    position: l.position,
    item_name: l.item_name,
    quantity: l.quantity == null ? null : Number(l.quantity),
    unit: l.unit,
    unit_price: l.unit_price == null ? null : Number(l.unit_price),
    line_total: l.line_total == null ? null : Number(l.line_total),
    matchedShoppingItemName: Array.isArray(l.shopping_list_items)
      ? (l.shopping_list_items[0]?.item_name ?? null)
      : (l.shopping_list_items?.item_name ?? null),
  }));

  const readOnly = ctx.membership.role === "family_member";

  const { data: allLines } = await supabase
    .from("bill_line_items")
    .select("id,item_name,quantity,unit,inventory_ingested_at,inventory_ingestion_skipped,matched_inventory_item_id")
    .eq("bill_id", id)
    .order("position", { ascending: true });

  const pending: LineRow[] = (allLines ?? [])
    .filter((l) => l.inventory_ingested_at === null && l.inventory_ingestion_skipped === false)
    .map((l) => ({ ...l, quantity: Number(l.quantity) }));
  const skipped: LineRow[] = (allLines ?? [])
    .filter((l) => l.inventory_ingestion_skipped === true)
    .map((l) => ({ ...l, quantity: Number(l.quantity) }));

  const { data: inv } = await supabase
    .from("inventory_items")
    .select("id,item_name,quantity,unit")
    .eq("household_id", ctx.household.id);
  const existingByName: Record<string, ExistingInvOption> = Object.fromEntries(
    (inv ?? []).map((i) => [i.item_name.toLowerCase(), { id: i.id, item_name: i.item_name, quantity: Number(i.quantity), unit: i.unit }]),
  );

  const canWrite = ctx.membership.role === "owner" || ctx.membership.role === "maid";

  let imageUrl: string | null = null;
  const signed = await supabase.storage
    .from("bill-images")
    .createSignedUrl(bill.image_storage_path, 3600);
  imageUrl = signed.data?.signedUrl ?? null;

  return (
    <main className="mx-auto max-w-md">
      <TopAppBar
        title="Bill details"
        leading={
          <IconButton variant="ghost" aria-label="Back" render={<Link href="/shopping?view=bills" />}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <BillDetailHeader
        status={bill.status}
        statusReason={bill.status_reason}
        storeName={bill.store_name}
        billDate={bill.bill_date}
        totalAmount={bill.total_amount}
        currency={bill.currency}
      />
      {imageUrl && (
        <div className="border-b border-border px-4 py-3">
          <BillImageViewer src={imageUrl} alt="Bill" />
        </div>
      )}
      {bill.status === "processing" && (
        <p className="px-4 py-6 text-center text-muted-foreground">
          Waiting for Claude to process the receipt — usually under 5 minutes.
        </p>
      )}
      {items.length > 0 && (
        <section>
          <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Line items</h2>
          <BillDetailActions billId={bill.id} mode="processed" items={items} readOnly={readOnly} />
        </section>
      )}
      <InventoryReviewQueue pending={pending} skipped={skipped} existingByName={existingByName} canWrite={canWrite} />
    </main>
  );
}
