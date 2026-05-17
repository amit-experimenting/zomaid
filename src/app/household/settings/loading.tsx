import { TopAppBar } from "@/components/ui/top-app-bar";

function MemberRow() {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-7 w-28 animate-pulse rounded-md bg-muted" />
        <div className="h-7 w-16 animate-pulse rounded-md bg-muted" />
      </div>
    </li>
  );
}

export default function HouseholdSettingsLoading() {
  return (
    <main className="mx-auto max-w-md">
      <TopAppBar title="Household settings" />
      <div className="space-y-8 px-4 py-6">
        <header className="flex flex-col gap-2">
          <div className="h-7 w-44 animate-pulse rounded bg-muted" />
          <div className="h-4 w-36 animate-pulse rounded bg-muted" />
        </header>

        <div className="rounded-xl border border-border p-4">
          <div className="h-5 w-24 animate-pulse rounded bg-muted" />
          <ul className="mt-3 divide-y">
            <MemberRow />
            <MemberRow />
          </ul>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="h-5 w-20 animate-pulse rounded bg-muted" />
          <div className="mt-4 space-y-3">
            <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      </div>
    </main>
  );
}
