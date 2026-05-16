import { TopAppBar } from "@/components/ui/top-app-bar";

export default function ShoppingLoading() {
  return (
    <main className="mx-auto max-w-md">
      <TopAppBar title="Shopping" />
      <div className="border-b border-border px-4 py-3">
        <div className="flex gap-2">
          <div className="h-8 flex-1 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-10 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
      <div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border px-4 py-3"
          >
            <div className="h-5 w-5 animate-pulse rounded bg-muted" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
