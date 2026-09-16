/**
 * @file Button.tsx
 * @description Kit button: cva variants (primary/secondary/ghost/danger) and
 * sizes (xs/sm/md) on the repo's dark-theme tokens. `to` renders a
 * react-router `<Link>` through Radix `Slot` with identical classes; `asChild`
 * slots onto any element; `loading` swaps the icon for a spinner and marks the
 * control busy + disabled.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Link } from "react-router";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm transition-colors duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-accent hover:bg-accent-hover text-white font-medium",
        secondary: "border border-border bg-surface-2 text-gray-200 hover:bg-surface-4",
        ghost: "text-gray-400 hover:text-gray-200 hover:bg-surface-4",
        danger: "bg-red-500/10 border border-red-500/25 text-red-300 hover:bg-red-500/20",
      },
      size: {
        xs: "px-2 py-1 text-xs",
        sm: "px-3 py-1.5",
        md: "px-4 py-2",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Leading Lucide icon; replaced by a spinner while `loading`. */
  icon?: LucideIcon;
  /** Shows a spinner and sets `aria-busy` + disabled. */
  loading?: boolean;
  /** Render onto the single child element instead of a `<button>`. */
  asChild?: boolean;
  /** Render as a react-router `<Link>` to this href. */
  to?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    size,
    icon: Icon,
    loading = false,
    asChild = false,
    to,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref
) {
  const iconClass = size === "xs" ? "w-3.5 h-3.5 shrink-0" : "w-4 h-4 shrink-0";
  const classes = cn(buttonVariants({ variant, size }), className);
  const lead = loading ? (
    <Loader2 aria-hidden className={cn(iconClass, "animate-spin motion-reduce:animate-none")} />
  ) : Icon ? (
    <Icon aria-hidden className={iconClass} />
  ) : null;
  const isDisabled = disabled || loading;

  if (to || asChild) {
    return (
      <Slot
        ref={ref}
        className={classes}
        aria-busy={loading || undefined}
        aria-disabled={isDisabled || undefined}
        {...rest}
      >
        {lead}
        <Slottable>{to ? <Link to={to}>{children}</Link> : children}</Slottable>
      </Slot>
    );
  }
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {lead}
      {children}
    </button>
  );
});
