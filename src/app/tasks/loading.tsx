import { MainNav } from "@/components/site/main-nav";

function TaskRow() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <div className="size-5 shrink-0 animate-pulse rounded bg-muted" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-4 w-44 animate-pulse rounded bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-3 w-12 animate-pulse rounded bg-muted" />
    </div>
  );
}

function DayHeader({ widthClass }: { widthClass: string }) {
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-2">
      <div className={`h-3 ${widthClass} animate-pulse rounded bg-muted`} />
    </div>
  );
}

function EmptyDay() {
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
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
          <div className="flex items-center gap-2">
            <div className="h-7 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-7 w-16 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      </header>

      {/* Overdue (tinted) */}
      <section>
        <div className="border-b border-border bg-destructive/10 px-4 py-2">
          <div className="h-3 w-20 animate-pulse rounded bg-destructive/30" />
        </div>
        <TaskRow />
      </section>

      {/* Today + next 4 named days */}
      <section>
        <DayHeader widthClass="w-16" />
        <TaskRow />
        <TaskRow />
      </section>
      <section>
        <DayHeader widthClass="w-28" />
        <TaskRow />
      </section>
      <section>
        <DayHeader widthClass="w-28" />
        <EmptyDay />
      </section>
      <section>
        <DayHeader widthClass="w-28" />
        <TaskRow />
      </section>
      <section>
        <DayHeader widthClass="w-28" />
        <EmptyDay />
      </section>

      {/* Later (collapsed) */}
      <section className="border-b border-border px-4 py-3">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </section>
    </main>
  );
}
