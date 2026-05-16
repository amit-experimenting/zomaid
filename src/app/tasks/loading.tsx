import { MainNav } from "@/components/site/main-nav";

function TaskRow() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <div className="h-5 w-5 animate-pulse rounded bg-muted" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-3 w-12 animate-pulse rounded bg-muted" />
    </div>
  );
}

export default function TasksLoading() {
  return (
    <main className="mx-auto max-w-md">
      <MainNav active="tasks" />
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="h-5 w-16 animate-pulse rounded bg-muted" />
          <div className="h-7 w-16 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted" />
      </header>
      <section>
        <div className="px-4 py-2">
          <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        </div>
        {[0, 1, 2].map((i) => (
          <TaskRow key={`t${i}`} />
        ))}
      </section>
      <section>
        <div className="px-4 py-2">
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        </div>
        {[0, 1, 2].map((i) => (
          <TaskRow key={`u${i}`} />
        ))}
      </section>
    </main>
  );
}
