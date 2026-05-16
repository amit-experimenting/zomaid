import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-sm border border-border bg-surface-1 px-3 text-base text-text-primary transition-colors outline-none",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-primary",
        "placeholder:text-text-muted",
        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
        "data-[invalid=true]:border-danger data-[invalid=true]:text-danger aria-invalid:border-danger aria-invalid:text-danger",
        className,
      )}
      {...props}
    />
  );
}

/** Size manifest consumed by the touch-target CI test. */
export const inputSizes = {
  md: { height: 44 },
} as const;

export { Input };
