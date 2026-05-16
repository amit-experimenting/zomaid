import { MainNav } from "@/components/site/main-nav";

export default function PlanLoading() {
  return (
    <main className="mx-auto max-w-md">
      <MainNav active="plan" />
      <header className="px-4 py-3">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      </header>
      <div className="flex flex-col">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border px-4 py-3"
          >
            <div className="h-12 w-12 animate-pulse rounded-md bg-muted" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-6 w-12 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="h-12 w-10 shrink-0 animate-pulse rounded-md bg-muted"
          />
        ))}
      </div>
    </main>
  );
}
