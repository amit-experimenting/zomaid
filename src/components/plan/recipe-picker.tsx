"use client";
import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Recipe = { id: string; name: string; slot: string; photo_url: string | null };

export function RecipePicker({
  slot, recipes, onPick, trigger, open, onOpenChange, pending,
}: {
  slot: string;
  recipes: Recipe[];
  onPick: (recipeId: string) => void;
  trigger: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Forwarded to the per-recipe pick button so it can show a spinner. */
  pending?: boolean;
}) {
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const filtered = recipes
    .filter((r) => r.slot === slot)
    .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <DialogHeader><DialogTitle>Pick a {slot} recipe</DialogTitle></DialogHeader>
        <Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="max-h-80 overflow-y-auto">
          {filtered.map((r) => (
            <li key={r.id} className="border-b border-border last:border-0">
              <Button
                variant="ghost"
                className="w-full justify-start"
                loading={pending && pickedId === r.id}
                disabled={pending && pickedId !== r.id}
                onClick={() => { setPickedId(r.id); onPick(r.id); }}
              >
                {r.name}
              </Button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="py-4 text-center text-sm text-muted-foreground">No recipes match</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
