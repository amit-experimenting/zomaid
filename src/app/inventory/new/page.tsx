import Link from "next/link";
import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createInventoryItem } from "@/app/inventory/actions";
import { MainNav } from "@/components/site/main-nav";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { OnboardingInventoryForm } from "./_onboarding-form";
import { UploadBillForm } from "./_bill-form";

type Mode = "manual" | "scan";

export default async function NewInventoryItemPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string; mode?: string }>;
}) {
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    redirect("/inventory");
  }
  const sp = await searchParams;
  const isOnboarding = sp.onboarding === "1";
  const mode: Mode =
    sp.mode === "scan" || sp.mode === "bill" ? "scan" : "manual";

  async function submitSingle(formData: FormData) {
    "use server";
    const name = String(formData.get("item_name") ?? "").trim();
    const quantity = Number(formData.get("quantity") ?? 0);
    const unit = String(formData.get("unit") ?? "").trim();
    if (!name || !unit || quantity < 0) return;
    await createInventoryItem({ item_name: name, quantity, unit });
    redirect("/inventory");
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="inventory" />
      {!isOnboarding && (
        <div className="px-4 pt-3">
          <Link href="/inventory" className="text-xs text-muted-foreground hover:text-foreground">
            ← Inventory
          </Link>
        </div>
      )}
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">
          {isOnboarding ? "Set up your inventory" : "Add an item"}
        </h1>
        {isOnboarding && (
          <p className="mt-1 text-sm text-muted-foreground">
            Fill in any quantities you have on hand. Skip items you don&apos;t track.
          </p>
        )}
      </header>

      {!isOnboarding && (
        <nav className="flex gap-1 border-b px-4" aria-label="Add inventory mode">
          <ModeTab href="/inventory/new" active={mode === "manual"}>
            Manual
          </ModeTab>
          <ModeTab href="/inventory/new?mode=scan" active={mode === "scan"}>
            Scan
          </ModeTab>
        </nav>
      )}

      {isOnboarding ? (
        <OnboardingInventoryForm />
      ) : mode === "scan" ? (
        <UploadBillForm />
      ) : (
        <form action={submitSingle} className="flex flex-col gap-3 px-4 py-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Name</span>
            <input
              name="item_name"
              required
              maxLength={120}
              className="rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Quantity</span>
            <input
              name="quantity"
              type="number"
              min="0"
              step="0.01"
              required
              className="rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Unit</span>
            <input
              name="unit"
              required
              maxLength={24}
              className="rounded border px-2 py-1 text-sm"
              placeholder="e.g. kg, g, l, ml, piece"
            />
          </label>
          <SubmitButton>Save</SubmitButton>
        </form>
      )}
    </main>
  );
}

function ModeTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "border-b-2 px-3 py-2 text-sm",
        active
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
