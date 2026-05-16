import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resetTaskSetupForEmptyState } from "@/app/onboarding/tasks/actions";

type Variant = "initial" | "rerun";

const COPY: Record<Variant, { title: string; body: string; cta: string }> = {
  initial: {
    title: "Set up your tasks",
    body: "Pick what applies to your home and decide who does what.",
    cta: "Set up tasks →",
  },
  rerun: {
    title: "No tasks yet",
    body: "Your task list is empty. Re-run setup to pick from the standard list.",
    cta: "Re-run setup →",
  },
};

export function TaskSetupPromptCard({ variant = "initial" }: { variant?: Variant }) {
  const copy = COPY[variant];
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <div className="text-sm font-semibold">{copy.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{copy.body}</div>
        </div>
        <div>
          {variant === "initial" ? (
            <Link
              href="/onboarding/tasks"
              className={cn(buttonVariants({ size: "sm" }))}
            >
              {copy.cta}
            </Link>
          ) : (
            <form action={resetTaskSetupForEmptyState}>
              <Button type="submit" size="sm">
                {copy.cta}
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
