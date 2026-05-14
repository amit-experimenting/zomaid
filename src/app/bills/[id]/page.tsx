import { notFound } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";
import { BillDetailHeader } from "@/components/bills/bill-detail-header";
import { LineItemRow } from "@/components/bills/line-item-row";
import { BillDetailActions } from "@/components/bills/_detail-actions";
import { InventoryReviewQueue, type LineRow, type ExistingInvOption } from "./_inventory-queue";

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: bill } = await supabase
    .from("bills")
    .select("id, household_id, status, status_reason, store_name, bill_date, total_amount, currency, image_storage_path, github_issue_url")
    .eq("id", id)
    .maybeSingle();
  if (!bill) notFound();

  const { data: lines } = await supabase
    .from("bill_line_items")
    .select("id, position, item_name, quantity, unit, unit_price, line_total, matched_shopping_item_id, shopping_list_items!matched_shopping_item_id(item_name)")
    .eq("bill_id", id)
    .order("position");

  const items = (lines ?? []).map((l: any) => ({
    id: l.id,
    position: l.position,
    item_name: l.item_name,
    quantity: l.quantity,
    unit: l.unit,
    unit_price: l.unit_price,
    line_total: l.line_total,
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
      <MainNav active="bills" />
      <BillDetailHeader
        status={bill.status}
        statusReason={bill.status_reason}
        storeName={bill.store_name}
        billDate={bill.bill_date}
        totalAmount={bill.total_amount}
        currency={bill.currency}
        githubIssueUrl={bill.github_issue_url}
      />
      {imageUrl && (
        <div className="border-b border-border px-4 py-3">
          <img src={imageUrl} alt="Bill" className="max-h-96 w-full rounded-md object-contain" />
        </div>
      )}
      {bill.status === "failed" && !readOnly && (
        <BillDetailActions billId={bill.id} mode="failed" />
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
