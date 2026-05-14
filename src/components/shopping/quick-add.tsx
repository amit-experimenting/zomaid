"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addShoppingItem,
  searchShoppingItems,
  unmarkShoppingItemBought,
  type ShoppingSearchResult,
} from "@/app/shopping/actions";

const DEBOUNCE_MS = 150;

function highlight(name: string, query: string) {
  const q = query.trim();
  if (!q) return name;
  const lower = name.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return name;
  return (
    <>
      {name.slice(0, idx)}
      <span className="font-semibold">{name.slice(idx, idx + q.length)}</span>
      {name.slice(idx + q.length)}
    </>
  );
}

export function QuickAdd({ onChanged }: { onChanged?: () => void }) {
  const [name, setName] = useState("");
  const [matches, setMatches] = useState<ShoppingSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>("");
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = name.trim();

  useEffect(() => {
    if (!trimmed) {
      lastQueryRef.current = "";
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = trimmed;
    debounceRef.current = setTimeout(async () => {
      lastQueryRef.current = q;
      const res = await searchShoppingItems({ query: q });
      // Ignore stale responses.
      if (lastQueryRef.current !== q) return;
      if (!res.ok) { setMatches([]); return; }
      setMatches(res.data);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimmed]);

  const reset = () => {
    setName("");
    setMatches([]);
    setOpen(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    lastQueryRef.current = "";
  };

  const flashMessage = (text: string, tone: "error" | "info") => {
    setMessage({ text, tone });
    setTimeout(() => setMessage(null), 3000);
  };

  const submitNew = (rawName: string) => {
    const value = rawName.trim();
    if (!value) return;
    start(async () => {
      const res = await addShoppingItem({ name: value });
      if (!res.ok) { flashMessage(res.error.message, "error"); return; }
      if (res.data.alreadyExists) flashMessage("Already on the list.", "info");
      reset();
      onChanged?.();
    });
  };

  const addBack = (itemId: string) => {
    start(async () => {
      const res = await unmarkShoppingItemBought({ itemId });
      if (!res.ok) { flashMessage(res.error.message, "error"); return; }
      reset();
      onChanged?.();
    });
  };

  const onEnter = () => {
    if (!trimmed) return;
    const exact = matches.find((m) => m.name.toLowerCase() === trimmed.toLowerCase());
    if (exact) {
      if (exact.boughtAt) addBack(exact.id);
      else { flashMessage("Already on the list.", "info"); reset(); }
      return;
    }
    submitNew(trimmed);
  };

  const showDropdown = open && trimmed.length > 0;

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="relative flex gap-2">
        <Input
          value={name}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            setOpen(true);
            if (!v.trim()) setMatches([]);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay close so a tap on a dropdown row registers first.
            blurTimerRef.current = setTimeout(() => setOpen(false), 120);
          }}
          placeholder="Add an item…"
          maxLength={120}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onEnter(); }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          disabled={pending}
        />
        <Button type="button" onClick={() => onEnter()} disabled={pending || !trimmed}>+</Button>
        {showDropdown && (
          <div
            className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-border bg-background shadow-md"
            onMouseDown={(e) => {
              // Prevent input blur before click handlers fire.
              e.preventDefault();
              if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            }}
          >
            {matches.map((m) => {
              const isBought = m.boughtAt !== null;
              return (
                <div key={m.id} className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className={isBought ? "truncate line-through text-muted-foreground" : "truncate"}>
                      {highlight(m.name, trimmed)}
                    </div>
                    <div className="text-xs text-muted-foreground">{isBought ? "Bought" : "On list"}</div>
                  </div>
                  {isBought ? (
                    <Button type="button" size="sm" onClick={() => addBack(m.id)} disabled={pending}>
                      Add back
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => { flashMessage("Already on the list.", "info"); reset(); }} disabled={pending}>
                      Already on list
                    </Button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/40 disabled:opacity-50"
              onClick={() => submitNew(trimmed)}
              disabled={pending}
            >
              + Add &quot;{trimmed}&quot; as new
            </button>
          </div>
        )}
      </div>
      {message && (
        <p className={"mt-1 text-xs " + (message.tone === "error" ? "text-destructive" : "text-muted-foreground")}>{message.text}</p>
      )}
    </div>
  );
}
