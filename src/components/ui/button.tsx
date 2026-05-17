import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-2",
    "rounded-sm border border-transparent bg-clip-padding font-medium whitespace-nowrap",
    "transition-colors outline-none select-none",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-soft active:bg-primary-pressed",
        secondary: "bg-surface-1 text-text-primary border-border hover:bg-primary-subtle",
        ghost: "bg-transparent text-primary hover:bg-primary-subtle",
        destructive: "bg-danger-subtle text-danger hover:bg-danger hover:text-primary-foreground focus-visible:ring-danger",
      },
      size: {
        sm: "h-9 px-4 text-sm",   // 36px — only allowed in toolbars (extendsRow)
        md: "h-11 px-5 text-sm",  // 44px — default
        lg: "h-[52px] px-6 text-base", // 52px — primary on-page CTAs (allowlisted file)
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * If true, shows a spinner before the children and disables the button.
     * The button's text remains visible — swap children yourself if you want
     * a different label while loading.
     */
    loading?: boolean;
  };

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </ButtonPrimitive>
  );
}

/** Size manifest consumed by the touch-target CI test. */
export const buttonSizes = {
  sm: { height: 36, extendsRow: true },
  md: { height: 44 },
  lg: { height: 52 },
} as const;

export { Button, buttonVariants };
