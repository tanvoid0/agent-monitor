/**
 * @file PageHeader.tsx
 * @description Page title row: icon tile, `<h1>`, optional subtitle, live pill,
 * back button (function), right-aligned actions, and an optional second row
 * (`children`) for tabs or filters. Classes mirror the Dashboard header; no
 * outer margin — pages space with their own column gap.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { IconButton } from "./IconButton";
import { LivePill } from "./LivePill";

export interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  /** Render a LivePill next to the title with this connection state. */
  live?: boolean;
  /** Back control: renders a button that calls this on click. */
  back?: () => void;
  actions?: ReactNode;
  /** Second row (tabs, filters). */
  children?: ReactNode;
  /** Merged onto the outermost element (margins, etc.). */
  className?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  live,
  back,
  actions,
  children,
  className,
}: PageHeaderProps) {
  const { t } = useTranslation();
  const row = (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-3", !children && className)}
    >
      <div className="flex items-center gap-3 min-w-0">
        {back && <IconButton icon={ArrowLeft} label={t("common:ui.back")} onClick={back} />}
        <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center flex-shrink-0">
          <Icon aria-hidden className="w-[18px] h-[18px] text-accent" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-gray-100 truncate">{title}</h1>
            {live !== undefined && <LivePill connected={live} />}
          </div>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
  return children ? (
    <div className={cn("flex flex-col gap-3", className)}>
      {row}
      {children}
    </div>
  ) : (
    row
  );
}
