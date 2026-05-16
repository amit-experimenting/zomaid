"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { PendingButton } from "@/components/ui/pending-button";
import { cancelFailedScan } from "../actions";

export type FailedAttemptCardProps = {
  attemptId: string;
  thumbnailUrl: string | null;
  uploadedAt: string;
  lastError: string | null;
  attempts: number;
};

export function FailedAttemptCard({
  attemptId,
  thumbnailUrl,
  uploadedAt,
  lastError,
  attempts,
}: FailedAttemptCardProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCancel() {
    setError(null);
    start(async () => {
      const r = await cancelFailedScan({ attemptId });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded border border-destructive/40 p-3">
      <div className="flex items-start gap-3">
        {thumbnailUrl ? (
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
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Couldn&apos;t read this bill</p>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
              Admin is looking
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Uploaded {new Date(uploadedAt).toLocaleString()} · {attempts} attempt
            {attempts === 1 ? "" : "s"}
          </p>
          {lastError && (
            <p className="text-xs text-muted-foreground">{lastError}</p>
          )}
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <PendingButton
          type="button"
          pending={pending}
          pendingLabel="Cancelling…"
          onClick={onCancel}
          variant="ghost"
          size="sm"
        >
          Cancel
        </PendingButton>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
