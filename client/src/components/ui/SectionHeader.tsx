/**
 * @file SectionHeader.tsx
 * @description In-page section heading: optional icon, title (`xs` uppercase
 * label or `sm` medium text), count badge, and right-aligned actions.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "./Badge";

export interface SectionHeaderProps {
  icon?: LucideIcon;
  title: string;
  count?: number | string;
  actions?: ReactNode;
  size?: "xs" | "sm";
  /** Merged onto the outer row (margins, etc.). */
  className?: string;
}

export function SectionHeader({
  icon: Icon,
  title,
  count,
  actions,
  size = "xs",
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon aria-hidden className="w-4 h-4 text-gray-500 shrink-0" />}
        <h2
          className={
            size === "xs"
              ? "text-xs font-semibold uppercase tracking-wider text-gray-400 truncate"
              : "text-sm font-medium text-gray-300 truncate"
          }
        >
          {title}
        </h2>
        {count !== undefined && <Badge size="xs">{count}</Badge>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
