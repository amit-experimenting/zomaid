"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSupabaseClient } from "@/lib/supabase/client";
import { MainNav } from "@/components/site/main-nav";
import { QuickAdd } from "@/components/shopping/quick-add";
import { AutoAddButton } from "@/components/shopping/auto-add-button";
import { ItemRow } from "@/components/shopping/item-row";
import { EditItemSheet } from "@/components/shopping/edit-item-sheet";
import { BoughtHistory, type BoughtItem } from "@/components/shopping/bought-history";
import { cn } from "@/lib/utils";
import { BillsTab } from "./_bills-tab";

type ShoppingItem = {
  id: string;
  item_name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  bought_at: string | null;
  checked_at: string | null;
  created_at: string;
};

type Role = "owner" | "maid" | "family_member";
type View = "list" | "bills";

export default function ShoppingPage() {
  // Note: this page is client-side because the user needs interactive checkboxes
  // and quick-add without a full server round-trip per keystroke. RLS still
  // gates every action server-side.
  const supabase = useSupabaseClient();
  const router = useRouter();
  const params = useSearchParams();
  const view: View = params.get("view") === "bills" ? "bills" : "list";

  const [unbought, setUnbought] = useState<ShoppingItem[]>([]);
  const [bought, setBought] = useState<ShoppingItem[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [editTarget, setEditTarget] = useState<ShoppingItem | null>(null);
  const [, start] = useTransition();

  const refresh = () => {
    start(async () => {
      const { data: u } = await supabase
        .from("shopping_list_items")
        .select("id,item_name,quantity,unit,notes,bought_at,checked_at,created_at")
        .is("bought_at", null)
        .order("created_at", { ascending: false });
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: b } = await supabase
        .from("shopping_list_items")
        .select("id,item_name,quantity,unit,notes,bought_at,checked_at,created_at")
        .gte("bought_at", sevenDaysAgo)
        .order("bought_at", { ascending: false });
      setUnbought((u ?? []) as ShoppingItem[]);
      setBought((b ?? []) as ShoppingItem[]);
    });
  };

  useEffect(() => {
    // Pull role and initial data on mount. We can't call requireHousehold from a
    // client component, so we fetch the membership via Supabase directly.
    start(async () => {
      const { data: meRows } = await supabase
        .from("household_memberships")
        .select("role")
        .eq("status", "active")
        .order("joined_at", { ascending: false })
        .limit(1);
      setRole(((meRows?.[0]?.role) ?? null) as Role | null);
      // initial fetch
      const { data: u } = await supabase
        .from("shopping_list_items")
        .select("id,item_name,quantity,unit,notes,bought_at,checked_at,created_at")
        .is("bought_at", null)
        .order("created_at", { ascending: false });
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: bRows } = await supabase
        .from("shopping_list_items")
        .select("id,item_name,quantity,unit,notes,bought_at,checked_at,created_at")
        .gte("bought_at", sevenDaysAgo)
        .order("bought_at", { ascending: false });
      setUnbought((u ?? []) as ShoppingItem[]);
      setBought((bRows ?? []) as ShoppingItem[]);
    });
    // supabase is stable (memoized); eslint-disable is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readOnly = role === "family_member" || role === null;
  const bHistory: BoughtItem[] = bought.map((b) => ({
    id: b.id,
    name: b.item_name,
    quantity: b.quantity,
    unit: b.unit,
    notes: b.notes,
    boughtAt: b.bought_at!,
  }));

  function setView(next: View) {
    const sp = new URLSearchParams(params);
    if (next === "list") sp.delete("view");
    else sp.set("view", "bills");
    const qs = sp.toString();
    router.replace(`/shopping${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="shopping" />
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="text-lg font-semibold">Shopping</h1>
        {view === "list" && !readOnly && <AutoAddButton />}
      </header>
      <nav className="flex gap-1 border-b border-border px-4" aria-label="Shopping view">
        <TabButton active={view === "list"} onClick={() => setView("list")}>
          List
        </TabButton>
        <TabButton active={view === "bills"} onClick={() => setView("bills")}>
          Bills
        </TabButton>
      </nav>

      {view === "list" ? (
        <>
          {!readOnly && <QuickAdd onChanged={refresh} />}
          {unbought.length === 0 && bought.length === 0 && (
            <p className="px-4 py-12 text-center text-muted-foreground">
              Nothing on the list. {readOnly ? "Wait for an owner or maid to add something." : "Add an item or pull from this week's plans."}
            </p>
          )}
          {unbought.map((it) => (
            <ItemRow
              key={it.id}
              itemId={it.id}
              name={it.item_name}
              quantity={it.quantity}
              unit={it.unit}
              notes={it.notes}
              checked={it.checked_at !== null}
              boughtAt={null}
              readOnly={readOnly}
              onEdit={readOnly ? undefined : () => setEditTarget(it)}
              onChanged={refresh}
            />
          ))}
          <BoughtHistory items={bHistory} readOnly={readOnly} onChanged={refresh} />
          {editTarget && (
            <EditItemSheet
              itemId={editTarget.id}
              initial={{
                name: editTarget.item_name,
                quantity: editTarget.quantity,
                unit: editTarget.unit,
                notes: editTarget.notes,
              }}
              open={editTarget !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setEditTarget(null);
                  refresh();
                }
              }}
            />
          )}
        </>
      ) : (
        <BillsTab />
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "border-b-2 px-3 py-2 text-sm",
        active
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
