import { Home, Package, ShoppingCart, Utensils } from "lucide-react";

import { TabBar, type Tab } from "./tab-bar";

const TABS: Tab[] = [
  { href: "/dashboard", label: "Home", icon: <Home /> },
  { href: "/recipes", label: "Meals", icon: <Utensils /> },
  { href: "/shopping", label: "Shop", icon: <ShoppingCart /> },
  { href: "/inventory", label: "Inventory", icon: <Package /> },
];

export function TabBarExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">TabBar</h2>
      <p className="text-sm text-text-secondary">
        Active state depends on the current pathname — won&apos;t highlight on this dev page.
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <TabBar tabs={TABS} className="static" />
      </div>
    </section>
  );
}
