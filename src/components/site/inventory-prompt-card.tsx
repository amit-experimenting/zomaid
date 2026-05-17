"use client";
import Link from "next/link";
import { useTransition } from "react";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dismissInventoryCard } from "@/app/inventory/actions";

export function InventoryPromptCard() {
  const [pending, start] = useTransition();
  return (
    <Banner
      tone="info"
      title="Set up your kitchen inventory"
      action={
        <div className="flex items-center justify-between gap-2">
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
      }
    >
      Track stock so the app can warn you when ingredients run low.
    </Banner>
  );
}
