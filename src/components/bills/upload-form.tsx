"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadBill } from "@/app/bills/actions";

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [storeHint, setStoreHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [phase, setPhase] = useState<"idle" | "compressing" | "submitting">("idle");

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setPhase("compressing");
    try {
      const compressed = await imageCompression(f, { maxSizeMB: 2, maxWidthOrHeight: 2400, useWebWorker: true });
      setFile(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compression failed");
    } finally {
      setPhase("idle");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("Pick an image first."); return; }
    setError(null);
    start(async () => {
      setPhase("submitting");
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (storeHint.trim()) fd.append("storeHint", storeHint.trim());
        const res = await uploadBill(fd);
        if (!res.ok) { setError(res.error.message); return; }
        router.push(`/bills/${res.data.billId}`);
      } finally {
        setPhase("idle");
      }
    });
  }

  return (
    <form className="mx-auto max-w-md space-y-4 p-4" onSubmit={submit}>
      <div>
        <Label htmlFor="bill-file">Receipt photo</Label>
        <input
          id="bill-file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={onFileChange}
          disabled={pending}
        />
      </div>
      <div>
        <Label htmlFor="bill-hint">Store hint (optional)</Label>
        <Input id="bill-hint" value={storeHint} onChange={(e) => setStoreHint(e.target.value)} placeholder="e.g., NTUC Tampines" maxLength={200} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending || !file || phase !== "idle"}>
        {phase === "compressing" ? "Compressing…" : phase === "submitting" ? "Uploading…" : "Upload bill"}
      </Button>
    </form>
  );
}
