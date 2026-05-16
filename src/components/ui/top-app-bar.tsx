import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
};

export function TopAppBar({ leading, title, subtitle, trailing, className }: Props) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center gap-1 border-b border-border bg-surface-1",
        "h-[52px] px-1 pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center">{leading}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-semibold text-text-primary">{title}</div>
        {subtitle ? <div className="truncate text-[13px] text-text-muted">{subtitle}</div> : null}
      </div>
      {trailing ? <div className="flex items-center gap-1">{trailing}</div> : null}
    </header>
  );
}
