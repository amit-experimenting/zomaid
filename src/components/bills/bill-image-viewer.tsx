"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Tap the thumbnail to open the bill photo full-screen. Esc closes, as does
 * a tap on the ✕ button or the dark backdrop. Portal-mounted so it sits
 * above any other stacking context on the page.
 */
export function BillImageViewer({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    // Lock page scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View bill image full-screen"
        className="block w-full"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-96 w-full rounded-md object-contain transition hover:opacity-90"
        />
        <p className="mt-1 text-xs text-muted-foreground">Tap to view full size</p>
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Bill image"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-sm text-white backdrop-blur hover:bg-white/20"
          >
            ✕ Close
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full object-contain"
          />
        </div>,
        document.body,
      )}
    </>
  );
}
