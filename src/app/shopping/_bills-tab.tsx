"use client";

import { useEffect, useState } from "react";
import { useSupabaseClient } from "@/lib/supabase/client";
import { BillCard } from "@/components/bills/bill-card";
import type { BillStatus } from "@/components/bills/status-badge";
import { UploadBillForm } from "@/app/inventory/new/_bill-form";

type BillRow = {
  id: string;
  status: BillStatus;
  store_name: string | null;
  bill_date: string | null;
  total_amount: number | null;
  currency: string;
  created_at: string;
};

export function BillsTab({ canUpload }: { canUpload: boolean }) {
  const supabase = useSupabaseClient();
  const [bills, setBills] = useState<BillRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Active household scoping is handled by RLS; we order client-side so
      // null bill_date rows (legacy / unprocessed) sort last regardless of
      // database collation quirks.
      const { data } = await supabase
        .from("bills")
        .select("id, status, store_name, bill_date, total_amount, currency, created_at")
        .order("bill_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setBills(((data ?? []) as BillRow[]));
    })();
    return () => {
      cancelled = true;
    };
    // supabase client is stable; we only fetch on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {canUpload && <UploadBillForm />}
      {bills === null ? (
        <div className="flex flex-col gap-2 p-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-5 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : bills.length === 0 ? (
        <p className="px-4 py-12 text-center text-muted-foreground">
          {canUpload ? "No bills yet. Upload one above." : "No bills yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-2 p-3">
          {bills.map((b) => (
            <BillCard
              key={b.id}
              id={b.id}
              status={b.status}
              storeName={b.store_name}
              billDate={b.bill_date}
              totalAmount={b.total_amount == null ? null : Number(b.total_amount)}
              currency={b.currency}
              createdAt={b.created_at}
            />
          ))}
        </div>
      )}
    </div>
  );
}
