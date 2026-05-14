import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createInventoryItem } from "@/app/inventory/actions";
import { MainNav } from "@/components/site/main-nav";
import { Button } from "@/components/ui/button";

const STARTER_ITEMS = [
  "basmati rice", "toor dal", "urad dal", "whole wheat flour", "cooking oil",
  "ghee", "salt", "sugar", "milk", "eggs",
  "onion", "tomato", "ginger", "garlic", "turmeric powder",
] as const;

export default async function NewInventoryItemPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    redirect("/inventory");
  }
  const sp = await searchParams;
  const isOnboarding = sp.onboarding === "1";

  async function submitSingle(formData: FormData) {
    "use server";
    const name = String(formData.get("item_name") ?? "").trim();
    const quantity = Number(formData.get("quantity") ?? 0);
    const unit = String(formData.get("unit") ?? "").trim();
    if (!name || !unit || quantity < 0) return;
    await createInventoryItem({ item_name: name, quantity, unit });
    redirect("/inventory");
  }

  async function submitOnboarding(formData: FormData) {
    "use server";
    for (const name of STARTER_ITEMS) {
      const qStr = formData.get(`qty_${name}`);
      const unit = formData.get(`unit_${name}`);
      const q = qStr ? Number(qStr) : 0;
      if (q > 0 && typeof unit === "string" && unit.length > 0) {
        await createInventoryItem({ item_name: name, quantity: q, unit });
      }
    }
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="inventory" />
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">{isOnboarding ? "Set up your inventory" : "Add an item"}</h1>
        {isOnboarding && (
          <p className="mt-1 text-sm text-muted-foreground">
            Fill in any quantities you have on hand. Skip items you don't track.
          </p>
        )}
      </header>

      {isOnboarding ? (
        <form action={submitOnboarding} className="flex flex-col gap-3 px-4 py-2">
          {STARTER_ITEMS.map((name) => (
            <div key={name} className="grid grid-cols-[1fr_80px_80px] items-center gap-2">
              <label htmlFor={`qty_${name}`} className="text-sm">{name}</label>
              <input
                id={`qty_${name}`}
                name={`qty_${name}`}
                type="number"
                min="0"
                step="0.01"
                className="rounded border px-2 py-1 text-sm"
                placeholder="0"
              />
              <select name={`unit_${name}`} className="rounded border px-2 py-1 text-sm" defaultValue="kg">
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="l">l</option>
                <option value="ml">ml</option>
                <option value="piece">piece</option>
              </select>
            </div>
          ))}
          <Button type="submit" className="mt-3">Save inventory</Button>
        </form>
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
          <Button type="submit">Save</Button>
        </form>
      )}
    </main>
  );
}
