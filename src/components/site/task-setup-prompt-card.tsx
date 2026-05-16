import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TaskSetupPromptCard() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <div className="text-sm font-semibold">Set up your tasks</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Pick what applies to your home and decide who does what.
          </div>
        </div>
        <div>
          <Link
            href="/onboarding/tasks"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Set up tasks →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
