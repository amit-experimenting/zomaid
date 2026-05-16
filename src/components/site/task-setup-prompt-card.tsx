import Link from "next/link";
import { Banner } from "@/components/ui/banner";
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
    <Banner
      tone="info"
      title={copy.title}
      action={
        variant === "initial" ? (
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
        )
      }
    >
      {copy.body}
    </Banner>
  );
}
