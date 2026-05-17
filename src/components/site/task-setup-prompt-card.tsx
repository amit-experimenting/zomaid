import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resetTaskSetupForEmptyState } from "@/app/onboarding/tasks/actions";

type Variant = "profile" | "picker" | "rerun";

const COPY: Record<Variant, { title: string; body: string; cta: string; href: string; isLink: boolean }> = {
  profile: {
    title: "Set up your household",
    body: "5 quick questions so the task picker only shows what fits your home.",
    cta: "Set up profile →",
    href: "/onboarding/profile",
    isLink: true,
  },
  picker: {
    title: "Pick your tasks",
    body: "Choose the chores that apply.",
    cta: "Pick tasks →",
    href: "/onboarding/tasks",
    isLink: true,
  },
  rerun: {
    title: "No tasks yet",
    body: "Your task list is empty. Re-run setup to pick from the standard list.",
    cta: "Re-run setup →",
    href: "",
    isLink: false,
  },
};

export function TaskSetupPromptCard({ variant = "picker" }: { variant?: Variant }) {
  const copy = COPY[variant];
  return (
    <Banner
      tone="info"
      title={copy.title}
      action={
        copy.isLink ? (
          <Link href={copy.href} className={cn(buttonVariants({ size: "sm" }))}>
            {copy.cta}
          </Link>
        ) : (
          <form action={resetTaskSetupForEmptyState}>
            <Button type="submit" size="sm">{copy.cta}</Button>
          </form>
        )
      }
    >
      {copy.body}
    </Banner>
  );
}
