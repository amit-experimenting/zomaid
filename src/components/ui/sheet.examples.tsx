"use client";

import { Button } from "./button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./sheet";

export function SheetExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Sheet</h2>
      <Sheet>
        <SheetTrigger render={<Button variant="secondary">Open bottom sheet</Button>} />
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Bottom sheet</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4 text-text-secondary">
            Sheets slide up from the bottom on mobile. The close button is provided
            by SheetContent.
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
