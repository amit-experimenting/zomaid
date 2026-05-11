"use client";
import { useState } from "react";
import { OccurrenceRow, type OccurrenceRowItem } from "./occurrence-row";
import { OccurrenceActionSheet } from "./occurrence-action-sheet";

export function TodayList({ items, readOnly }: { items: OccurrenceRowItem[]; readOnly: boolean }) {
  const [target, setTarget] = useState<OccurrenceRowItem | null>(null);
  return (
    <>
      {items.map((it) => (
        <OccurrenceRow
          key={it.occurrenceId}
          item={it}
          readOnly={readOnly}
          onTap={() => !readOnly && setTarget(it)}
        />
      ))}
      {target && (
        <OccurrenceActionSheet
          occurrenceId={target.occurrenceId}
          taskId={target.taskId}
          title={target.title}
          isStandard={target.isStandard}
          open={target !== null}
          onOpenChange={(open) => { if (!open) setTarget(null); }}
        />
      )}
    </>
  );
}
