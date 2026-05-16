"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { resetBillScan, resolveBillScan } from "./actions";

export type AdminScanRow = {
  id: string;
  storageThumbUrl: string | null;
  createdAt: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  uploaderName: string | null;
  householdName: string | null;
};

export function AdminBillScansClient({ rows }: { rows: AdminScanRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset(id: string) {
    setError(null);
    setPendingId(id);
    start(async () => {
      const r = await resetBillScan({ attemptId: id });
      setPendingId(null);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }
  function resolve(id: string) {
    setError(null);
    setPendingId(id);
    start(async () => {
      const r = await resolveBillScan({ attemptId: id });
      setPendingId(null);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No failed scans in the queue.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {error && (
        <p className="rounded border border-destructive bg-destructive/10 px-2 py-1 text-sm text-destructive">
          {error}
        </p>
      )}
      {rows.map((row) => {
        const busy = isPending && pendingId === row.id;
        return (
          <div key={row.id} className="rounded border p-3">
            <div className="flex items-start gap-3">
              {row.storageThumbUrl ? (
                <Image
                  src={row.storageThumbUrl}
                  alt="bill thumbnail"
                  width={96}
                  height={96}
                  unoptimized
                  className="h-24 w-24 rounded border object-cover"
                />
              ) : (
                <div className="h-24 w-24 rounded border bg-muted" />
              )}
              <div className="flex flex-1 flex-col gap-1">
                <p className="text-sm font-medium">
                  {row.householdName ?? "(no household)"} ·{" "}
                  {row.uploaderName ?? "(no uploader)"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Uploaded {new Date(row.createdAt).toLocaleString()} ·{" "}
                  {row.attempts}/{row.maxAttempts} attempts
                </p>
                {row.lastError && (
                  <p className="text-xs text-muted-foreground">
                    Last error: {row.lastError}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                loading={busy}
                onClick={() => resolve(row.id)}
                variant="ghost"
                size="sm"
              >
                {busy ? "Resolving…" : "Mark resolved"}
              </Button>
              <Button
                type="button"
                loading={busy}
                onClick={() => reset(row.id)}
                size="sm"
              >
                {busy ? "Resetting…" : "Reset to pending"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
