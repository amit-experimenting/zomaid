import { type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const bannerVariants = cva(
  "flex gap-3 rounded-md border p-3",
  {
    variants: {
      tone: {
        info: "bg-info-subtle border-[color:var(--info)]/30",
        success: "bg-success-subtle border-[color:var(--success)]/30",
        warning: "bg-warning-subtle border-[color:var(--warning)]/30",
        danger: "bg-danger-subtle border-[color:var(--danger)]/30",
        neutral: "bg-surface-1 border-border",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const iconChip = cva(
  "inline-flex size-6 shrink-0 items-center justify-center rounded text-[12px] font-bold text-white",
  {
    variants: {
      tone: {
        info: "bg-info",
        success: "bg-success",
        warning: "bg-warning",
        danger: "bg-danger",
        neutral: "bg-text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type BannerProps = VariantProps<typeof bannerVariants> & {
  icon?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function Banner({ tone, icon, title, children, action, className }: BannerProps) {
  const defaultGlyph: Record<NonNullable<typeof tone>, string> = {
    info: "i", success: "✓", warning: "!", danger: "×", neutral: "•",
  };
  const t = tone ?? "neutral";
  return (
    <div className={cn(bannerVariants({ tone: t }), className)} role="status">
      <span className={iconChip({ tone: t })} aria-hidden>{icon ?? defaultGlyph[t]}</span>
      <div className="flex-1 text-sm text-text-secondary leading-snug">
        {title ? <div className="font-semibold text-text-primary mb-0.5">{title}</div> : null}
        {children}
        {action ? <div className="mt-1">{action}</div> : null}
      </div>
    </div>
  );
}
