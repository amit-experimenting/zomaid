import { ChevronLeft, MoreHorizontal, Plus, Search, X } from "lucide-react";

import { IconButton } from "./icon-button";

export function IconButtonExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">IconButton</h2>

      <div className="flex flex-wrap items-center gap-3">
        <IconButton variant="filled" aria-label="Add">
          <Plus />
        </IconButton>
        <IconButton variant="tonal" aria-label="Search">
          <Search />
        </IconButton>
        <IconButton variant="ghost" aria-label="Back">
          <ChevronLeft />
        </IconButton>
        <IconButton variant="ghost" aria-label="More">
          <MoreHorizontal />
        </IconButton>
        <IconButton variant="ghost" aria-label="Close">
          <X />
        </IconButton>
        <IconButton variant="filled" aria-label="Disabled add" disabled>
          <Plus />
        </IconButton>
      </div>
    </section>
  );
}
