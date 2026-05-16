import { ChevronLeft, MoreHorizontal, Search } from "lucide-react";

import { IconButton } from "./icon-button";
import { TopAppBar } from "./top-app-bar";

export function TopAppBarExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">TopAppBar</h2>

      <div className="overflow-hidden rounded-md border border-border">
        <TopAppBar title="Title only" />
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <TopAppBar
          leading={
            <IconButton variant="ghost" aria-label="Back">
              <ChevronLeft />
            </IconButton>
          }
          title="With back button"
        />
      </div>

      <div className="overflow-hidden rounded-md border border-border">
        <TopAppBar
          title="Title and subtitle"
          subtitle="Plus trailing actions"
          trailing={
            <>
              <IconButton variant="ghost" aria-label="Search">
                <Search />
              </IconButton>
              <IconButton variant="ghost" aria-label="More">
                <MoreHorizontal />
              </IconButton>
            </>
          }
        />
      </div>
    </section>
  );
}
