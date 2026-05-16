import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field-sizing-content min-h-[88px] w-full rounded-sm border border-border bg-surface-1 px-3 py-2 text-base text-text-primary outline-none placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[invalid=true]:border-danger data-[invalid=true]:text-danger aria-invalid:border-danger aria-invalid:text-danger",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
