import { Package, ShoppingCart, Utensils } from "lucide-react";

import { Button } from "./button";
import { ListRow } from "./list-row";

export function ListRowExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">ListRow</h2>

      <div className="overflow-hidden rounded-md border border-border bg-surface-1">
        <ListRow mode="navigational" href="#" title="Navigational row" />
        <ListRow
          mode="navigational"
          href="#"
          leading={<Utensils className="size-5 text-text-secondary" />}
          title="With leading and subtitle"
          subtitle="Tap to view recipes"
        />
        <ListRow mode="static" title="Static row" />
        <ListRow
          mode="static"
          leading={<Package className="size-5 text-text-secondary" />}
          title="Static with leading"
          subtitle="No chevron, no action"
        />
        <ListRow
          mode="actionable"
          title="Actionable row"
          action={<Button size="sm" variant="secondary">Do it</Button>}
        />
        <ListRow
          mode="actionable"
          leading={<ShoppingCart className="size-5 text-text-secondary" />}
          title="Actionable with leading"
          subtitle="Has a trailing action"
          action={<Button size="sm">Add</Button>}
        />
      </div>
    </section>
  );
}
