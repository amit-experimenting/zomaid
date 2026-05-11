import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { MainNav } from "@/components/site/main-nav";
import { BillCard } from "@/components/bills/bill-card";

export default async function BillsIndex() {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data } = await supabase
    .from("bills")
    .select("id, status, store_name, bill_date, total_amount, currency, created_at")
    .eq("household_id", ctx.household.id)
    .order("created_at", { ascending: false });
  const bills = data ?? [];

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="bills" />
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Bills</h1>
        <Link href="/bills/new"><Button size="sm">+ New</Button></Link>
      </header>
      {bills.length === 0 && (
        <p className="px-4 py-12 text-center text-muted-foreground">
          No bills yet. <Link href="/bills/new" className="underline">Upload one</Link>.
        </p>
      )}
      <div className="flex flex-col gap-2 p-3">
        {bills.map((b) => (
          <BillCard
            key={b.id}
            id={b.id}
            status={b.status}
            storeName={b.store_name}
            billDate={b.bill_date}
            totalAmount={b.total_amount}
            currency={b.currency}
            createdAt={b.created_at}
          />
        ))}
      </div>
    </main>
  );
}
