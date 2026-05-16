"use client";

import { Button } from "./button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";

export function DialogExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Dialog</h2>
      <Dialog>
        <DialogTrigger render={<Button variant="secondary">Open dialog</Button>} />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm action</DialogTitle>
          </DialogHeader>
          <p className="text-text-secondary">
            This is a live dialog. The close button in the top-right is provided by
            DialogContent.
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
