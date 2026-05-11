"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addShoppingItem } from "@/app/shopping/actions";

export function QuickAdd() {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    start(async () => {
      const res = await addShoppingItem({ name: trimmed });
      if (!res.ok) { setError(res.error.message); return; }
      setName("");
      setError(null);
    });
  };
  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add an item…"
          maxLength={120}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          disabled={pending}
        />
        <Button type="button" onClick={submit} disabled={pending || !name.trim()}>+</Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
