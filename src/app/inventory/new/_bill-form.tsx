"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import {
  BillConfirmForm,
  type ConfirmFormInitial,
} from "@/components/bills/bill-confirm-form";
import { PendingButton } from "@/components/ui/pending-button";

type ScanResponse =
  | { ok: true; data: ConfirmFormInitial }
  | {
      ok: false;
      error: { code: string; message: string; attemptId?: string };
    };

type Phase = "pick" | "compressing" | "scanning" | "confirm";

export function UploadBillForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [initial, setInitial] = useState<ConfirmFormInitial | null>(null);

  function resetToPick() {
    setPhase("pick");
    setFile(null);
    setError(null);
    setInitial(null);
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setError(null);
    setQueuedNotice(null);
    setPhase("compressing");
    try {
      const compressed = await imageCompression(picked, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });
      setFile(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't compress that image.");
      setFile(null);
    } finally {
      setPhase("pick");
    }
  }

  async function onScan() {
    if (!file) {
      setError("Pick a photo first.");
      return;
    }
    setError(null);
    setQueuedNotice(null);
    setPhase("scanning");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/bills/scan", { method: "POST", body: fd });
      const body = (await res.json()) as ScanResponse;
      if (body.ok === true) {
        setInitial(body.data);
        setPhase("confirm");
        return;
      }
      // ── Queued-for-retry branch ────────────────────────────────────
      if (body.error.code === "BILL_SCAN_QUEUED") {
        setQueuedNotice(body.error.message);
        setFile(null);
        setPhase("pick");
        return;
      }
      setError(body.error.message);
      setPhase("pick");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed. Try again.");
      setPhase("pick");
    }
  }

  if (phase !== "confirm") {
    const busy = phase === "compressing" || phase === "scanning";
    return (
      <div className="flex flex-col gap-3 px-4 py-2">
        <div className="flex flex-col gap-2 rounded border border-dashed p-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Bill photo</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={onFileChange}
              disabled={busy}
              className="text-sm"
            />
          </label>
          <PendingButton
            type="button"
            pending={busy}
            pendingLabel={phase === "compressing" ? "Compressing…" : "Scanning…"}
            onClick={onScan}
            disabled={!file || busy}
            className="self-start"
          >
            Scan bill
          </PendingButton>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {queuedNotice && (
            <div className="rounded border border-amber-500/40 bg-amber-100/40 p-2 text-sm">
              <p>{queuedNotice}</p>
              <p className="mt-1">
                <Link
                  href="/scans/pending"
                  className="underline underline-offset-2"
                >
                  View pending scans
                </Link>
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            We read the bill, then show you the parsed result so you can edit
            before saving. The photo isn&apos;t stored — only the line items.
          </p>
        </div>
      </div>
    );
  }

  // phase === "confirm"
  return (
    <div className="px-4 py-2">
      {initial && (
        <BillConfirmForm
          initial={initial}
          onSaved={(billId) => router.push(`/bills/${billId}`)}
          onDiscard={resetToPick}
        />
      )}
    </div>
  );
}
