/**
 * @file Badge.tsx
 * @description Kit pill: cva tones (neutral/accent/success/warning/danger/
 * info/violet) and sizes (xs, sm = legacy `.badge` metrics), optional leading
 * status dot (`dot`, `pulse`), Lucide icon, and monospace text.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border font-medium whitespace-nowrap shrink-0",
  {
    variants: {
      tone: {
        neutral: "text-gray-300 bg-surface-4 border-border",
        accent: "text-indigo-300 bg-indigo-500/10 border-indigo-500/25",
        success: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
        warning: "text-amber-300 bg-amber-500/10 border-amber-500/25",
        danger: "text-red-300 bg-red-500/10 border-red-500/25",
        info: "text-sky-300 bg-sky-500/10 border-sky-500/25",
        violet: "text-violet-300 bg-violet-500/10 border-violet-500/25",
      },
      size: {
        xs: "text-[10px] px-1.5 py-0.5 gap-1",
        sm: "text-xs px-2.5 py-1 gap-1.5",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Leading status dot in the current text colour. */
  dot?: boolean;
  /** Animate the dot (respects `prefers-reduced-motion`). */
  pulse?: boolean;
  icon?: LucideIcon;
  mono?: boolean;
}

export function Badge({
  tone,
  size,
  dot,
  pulse,
  icon: Icon,
  mono,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), mono && "font-mono", className)} {...rest}>
      {dot && (
        <span
          aria-hidden
          className={cn(
            "w-1.5 h-1.5 rounded-full bg-current",
            pulse && "animate-pulse motion-reduce:animate-none"
          )}
        />
      )}
      {Icon && <Icon aria-hidden className={size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5"} />}
      {children}
    </span>
  );
}
