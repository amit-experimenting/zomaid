import { MainNav } from "@/components/site/main-nav";

export default function DashboardLoading() {
  return (
    <main className="mx-auto max-w-md">
      <MainNav active="home" />
      <div className="px-4 py-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="h-7 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="mt-6 rounded-xl border border-border p-4">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-4 h-16 w-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    </main>
  );
}
