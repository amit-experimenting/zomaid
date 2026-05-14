import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { MainNav } from "@/components/site/main-nav";

export default async function ConversionsPage() {
  const ctx = await requireHousehold();
  const supabase = await createClient();

  const { data: defaults } = await supabase
    .from("unit_conversions")
    .select("id,item_name,from_unit,to_unit,multiplier")
    .is("household_id", null)
    .order("item_name", { ascending: true, nullsFirst: true })
    .order("from_unit", { ascending: true });

  const { data: overrides } = await supabase
    .from("unit_conversions")
    .select("id,item_name,from_unit,to_unit,multiplier")
    .eq("household_id", ctx.household.id)
    .order("item_name", { ascending: true, nullsFirst: true });

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="inventory" />
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">Unit conversions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Zomaid defaults are used to translate between cooking units (cup, tbsp) and stock units (kg, g, l, ml).
          Add household-specific overrides below if a default doesn't match how you measure.
        </p>
      </header>
      <section className="px-4 py-2">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your overrides</h2>
        {(overrides?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground">No overrides yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {overrides!.map((c) => (
              <li key={c.id} className="flex items-center justify-between border-b py-1 text-sm">
                <span>{c.item_name ?? "(generic)"} — 1 {c.from_unit} → {c.multiplier} {c.to_unit}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Zomaid defaults ({defaults?.length ?? 0})</h2>
        <ul className="flex flex-col gap-1">
          {defaults?.map((c) => (
            <li key={c.id} className="flex items-center justify-between border-b py-1 text-xs">
              <span>{c.item_name ?? "(generic)"}</span>
              <span>1 {c.from_unit} = {c.multiplier} {c.to_unit}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
