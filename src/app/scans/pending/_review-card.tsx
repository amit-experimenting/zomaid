"use client";

// Single-attempt review card on /scans/pending.
//
// Collapsed: shows the thumbnail, a "Review & save" button, and a
// "Discard" button. Expanded: renders the shared BillConfirmForm pre-filled
// from parsed_payload. On save, navigates to the new bill page.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  BillConfirmForm,
  type ConfirmFormInitial,
} from "@/components/bills/bill-confirm-form";
import { PendingButton } from "@/components/ui/pending-button";
import { discardPendingScan } from "../actions";

export type SucceededAttemptCardProps = {
  attemptId: string;
  thumbnailUrl: string | null;
  uploadedAt: string;
  initial: ConfirmFormInitial;
};

export function SucceededAttemptCard({
  attemptId,
  thumbnailUrl,
  uploadedAt,
  initial,
}: SucceededAttemptCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [discarding, startDiscard] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDiscard() {
    setError(null);
    startDiscard(async () => {
      const r = await discardPendingScan({ attemptId });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded border p-3">
      <div className="flex items-start gap-3">
        {thumbnailUrl ? (
          // Next/Image with `unoptimized` because the URL is a short-lived
          // Supabase signed URL — the optimizer would cache the variant key.
          <Image
            src={thumbnailUrl}
            alt="bill thumbnail"
            width={72}
            height={72}
            unoptimized
            className="h-18 w-18 rounded border object-cover"
          />
        ) : (
          <div className="h-18 w-18 rounded border bg-muted" />
        )}
        <div className="flex flex-1 flex-col gap-1">
          <p className="text-sm font-medium">Ready to review</p>
          <p className="text-xs text-muted-foreground">
            Uploaded {new Date(uploadedAt).toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">
            {initial.items.length} line{initial.items.length === 1 ? "" : "s"} ·{" "}
            {initial.store_name ?? "no store name"} ·{" "}
            {initial.bill_date ?? "no date"}
          </p>
        </div>
      </div>

      {!open ? (
        <div className="mt-2 flex justify-end gap-2">
          <PendingButton
            type="button"
            pending={discarding}
            pendingLabel="Discarding…"
            onClick={onDiscard}
            variant="ghost"
            size="sm"
          >
            Discard
          </PendingButton>
          <PendingButton
            type="button"
            onClick={() => setOpen(true)}
            size="sm"
          >
            Review &amp; save
          </PendingButton>
        </div>
      ) : (
        <div className="mt-3 border-t pt-3">
          <BillConfirmForm
            initial={initial}
            attemptId={attemptId}
            onSaved={(billId) => router.push(`/bills/${billId}`)}
            onDiscard={() => setOpen(false)}
          />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
