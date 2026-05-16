import Link from "next/link";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Common = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
};

type NavRow = Common & { mode: "navigational"; href: string };
type StaticRow = Common & { mode?: "static" };
type ActionableRow = Common & { mode: "actionable"; action: ReactNode };

export type ListRowProps = NavRow | StaticRow | ActionableRow;

const rowBase =
  "flex min-h-14 items-center gap-3 px-4 py-2.5 border-b border-border last:border-0";
const rowInteractive = "hover:bg-primary-subtle/50 active:bg-primary-subtle";

function Body({ leading, title, subtitle, trailing }: Common) {
  return (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-text-primary">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[13px] text-text-secondary">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </>
  );
}

export function ListRow(props: ListRowProps) {
  if (props.mode === "navigational") {
    const { href, leading, title, subtitle, trailing, className } = props;
    return (
      <Link href={href} className={cn(rowBase, rowInteractive, className)}>
        <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing ?? <span aria-hidden className="text-text-disabled">›</span>} />
      </Link>
    );
  }
  if (props.mode === "actionable") {
    const { action, leading, title, subtitle, className } = props;
    return (
      <div className={cn(rowBase, className)}>
        <Body leading={leading} title={title} subtitle={subtitle} trailing={action} />
      </div>
    );
  }
  const { leading, title, subtitle, trailing, className } = props;
  return (
    <div className={cn(rowBase, className)}>
      <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing} />
    </div>
  );
}

export const listRowSizes = { default: { height: 56 } } as const;
