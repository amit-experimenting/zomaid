"use client";
import { useState } from "react";
import { OccurrenceRow, type OccurrenceRowItem } from "./occurrence-row";
import { OccurrenceActionSheet } from "./occurrence-action-sheet";

export type DaySection = {
  /** YYYY-MM-DD key for stable React keys (unused visually). */
  ymd: string;
  /** Section title: "Today", "Tomorrow", "Wed 21 May", etc. */
  label: string;
  /** Optional secondary label shown next to the heading, e.g. the date. */
  subLabel?: string;
  items: OccurrenceRowItem[];
};

export type DaySectionsProps = {
  overdue: OccurrenceRowItem[];
  days: DaySection[];
  later: OccurrenceRowItem[];
  /** Header text for Later, e.g. "Later (3)". Omitted when later is empty. */
  laterLabel?: string;
  readOnly: boolean;
};

export function DaySections({
  overdue,
  days,
  later,
  laterLabel,
  readOnly,
}: DaySectionsProps) {
  const [target, setTarget] = useState<OccurrenceRowItem | null>(null);

  const onTap = (it: OccurrenceRowItem) => {
    if (!readOnly) setTarget(it);
  };

  return (
    <>
      {overdue.length > 0 && (
        <section className="border-l-4 border-destructive bg-destructive/5">
          <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-destructive">
            Overdue
            <span className="ml-2 text-xs font-normal normal-case opacity-80">
              {overdue.length} item{overdue.length === 1 ? "" : "s"}
            </span>
          </h2>
          {overdue.map((it) => (
            <OccurrenceRow
              key={it.occurrenceId}
              item={it}
              readOnly={readOnly}
              onTap={() => onTap(it)}
            />
          ))}
        </section>
      )}

      {days.map((d) => (
        <section key={d.ymd}>
          <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {d.label}
            {d.subLabel && (
              <span className="ml-2 text-xs font-normal normal-case text-muted-foreground/70">
                {d.subLabel}
              </span>
            )}
          </h2>
          {d.items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground/60">
              Nothing scheduled.
            </p>
          ) : (
            d.items.map((it) => (
              <OccurrenceRow
                key={it.occurrenceId}
                item={it}
                readOnly={readOnly}
                onTap={() => onTap(it)}
              />
            ))
          )}
        </section>
      ))}

      {later.length > 0 && (
        <details className="border-t border-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/50">
            {laterLabel ?? `Later (${later.length})`}
          </summary>
          {later.map((it) => (
            <OccurrenceRow
              key={it.occurrenceId}
              item={it}
              readOnly={readOnly}
              onTap={() => onTap(it)}
            />
          ))}
        </details>
      )}

      {target && (
        <OccurrenceActionSheet
          occurrenceId={target.occurrenceId}
          taskId={target.taskId}
          title={target.title}
          isStandard={target.isStandard}
          open={target !== null}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
        />
      )}
    </>
  );
}
