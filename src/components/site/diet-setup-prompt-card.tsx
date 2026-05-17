import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DietSetupPromptCard() {
  return (
    <Banner
      tone="info"
      title="Set up your family's diet preference"
      action={
        <Link
          href="/household/settings#diet"
          className={cn(buttonVariants({ size: "sm" }))}
        >
          Set diet →
        </Link>
      }
    >
      We won&apos;t suggest any meals until you tell us what your family eats.
    </Banner>
  );
}
