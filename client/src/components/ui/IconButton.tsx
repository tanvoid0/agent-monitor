/**
 * @file IconButton.tsx
 * @description Square icon-only button built on {@link Button}. `label` is
 * required and becomes both `aria-label` and `title`. Sizes never drop below
 * the 24px WCAG target floor (xs 24px, sm 28px, md 32px).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { cn } from "../../lib/cn";

const SIZE = { xs: "w-6 h-6", sm: "w-7 h-7", md: "w-8 h-8" } as const;

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name — rendered as `aria-label` and `title`. */
  label: string;
  size?: keyof typeof SIZE;
  variant?: "ghost" | "secondary" | "danger";
  /** Render as a react-router `<Link>` to this href. */
  to?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "sm", variant = "ghost", className, ...rest },
  ref
) {
  return (
    <Button
      ref={ref}
      icon={icon}
      size={size}
      variant={variant}
      aria-label={label}
      title={label}
      className={cn("p-0 rounded-md", SIZE[size], className)}
      {...rest}
    />
  );
});
