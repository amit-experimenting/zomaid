"use client";
import Link from "next/link";
import { useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dismissInventoryCard } from "@/app/inventory/actions";

export function InventoryPromptCard() {
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <div className="text-sm font-semibold">Set up your kitchen inventory</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Track stock so the app can warn you when ingredients run low.
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Link
            href="/inventory/new?onboarding=1"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Add starter items →
          </Link>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => start(async () => { await dismissInventoryCard(); })}
          >
            Skip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
