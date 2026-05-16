import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  [
    "inline-flex size-11 items-center justify-center rounded-sm",
    "transition-colors outline-none select-none",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:size-5",
  ].join(" "),
  {
    variants: {
      variant: {
        filled: "bg-primary text-primary-foreground hover:bg-primary-soft active:bg-primary-pressed",
        tonal: "bg-primary-subtle text-primary hover:bg-primary-subtle/70",
        ghost: "bg-transparent text-primary hover:bg-primary-subtle",
      },
    },
    defaultVariants: { variant: "ghost" },
  },
);

type IconButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof iconButtonVariants> & {
    "aria-label": string;
  };

export function IconButton({ className, variant, ...props }: IconButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="icon-button"
      className={cn(iconButtonVariants({ variant, className }))}
      {...props}
    />
  );
}

export const iconButtonSizes = { default: { height: 44 } } as const;
