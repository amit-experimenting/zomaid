"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tab = {
  href: string;
  label: string;
  icon: ReactNode;
  /** When set, matches if pathname startsWith any of these prefixes. Defaults to [href]. */
  match?: string[];
};

type Props = { tabs: Tab[]; className?: string };

export function TabBar({ tabs, className }: Props) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className={cn(
        "sticky bottom-0 z-30 flex border-t border-border bg-surface-1",
        "h-14 pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {tabs.map(tab => {
        const prefixes = tab.match ?? [tab.href];
        const active = prefixes.some(p => pathname === p || pathname.startsWith(p + "/"));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold",
              active ? "text-primary" : "text-text-muted",
            )}
          >
            <span aria-hidden className="[&_svg]:size-[18px]">{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export const tabBarSizes = { default: { height: 56 } } as const;
