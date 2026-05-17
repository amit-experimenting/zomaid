import { TopAppBar } from "@/components/ui/top-app-bar";

export default function InventoryLoading() {
  return (
    <main className="mx-auto max-w-md">
      <TopAppBar title="Inventory" />
      <div className="flex flex-col gap-2 px-4 py-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-md border border-border p-3"
          >
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-6 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="px-4 py-3">
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      </div>
    </main>
  );
}
