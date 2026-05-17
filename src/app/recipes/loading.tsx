import { TopAppBar } from "@/components/ui/top-app-bar";

export default function RecipesLoading() {
  return (
    <main className="mx-auto max-w-md">
      <TopAppBar title="Recipes" />
      <div className="px-4 py-4">
        <div className="flex gap-2">
          <div className="h-8 flex-1 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="mt-4 grid gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-md border border-border p-3"
            >
              <div className="h-14 w-14 animate-pulse rounded-md bg-muted" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
