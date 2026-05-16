"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof Button>;

export type PendingButtonProps = ButtonProps & {
  /** External pending signal (e.g. from useTransition). OR'd with form status. */
  pending?: boolean;
  /** Optional label shown next to the spinner while pending. Defaults to children. */
  pendingLabel?: React.ReactNode;
};

/**
 * Drop-in replacement for `Button` that shows a spinner and goes disabled
 * while either (a) the caller-supplied `pending` is true or (b) the parent
 * `<form action={…}>` is currently submitting (via `useFormStatus`).
 *
 * Outside a form, `useFormStatus` always returns `{ pending: false }` —
 * harmless. So this component is safe to use anywhere `Button` is used.
 */
export function PendingButton({
  pending: pendingProp,
  pendingLabel,
  disabled,
  children,
  className,
  ...rest
}: PendingButtonProps) {
  const status = useFormStatus();
  const pending = Boolean(pendingProp) || status.pending;
  return (
    <Button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(className)}
    >
      {pending ? <Spinner /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="animate-spin"
      width={12}
      height={12}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
        fill="none"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
