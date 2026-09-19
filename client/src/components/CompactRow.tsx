/**
 * @file CompactRow.tsx
 * @description Shared one-line row layout for `AgentCard`/`SessionCard`'s
 * `variant="row"`: status badge -> name -> optional subtitle -> optional chip
 * -> optional progress indicator -> timestamp -> kebab menu, all inside a
 * `Clickable` surface. Both cards render identical markup here; only the
 * pieces that differ per entity (badge, name, subtitle, chip) come in as
 * props.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import type { ReactNode } from "react";
import { Clickable, MenuButton } from "./ui";
import type { MenuItem } from "./ui";
import { formatDateTimeFull, timeAgo } from "../lib/format";

interface CompactRowProps {
  to?: string;
  onActivate?: () => void;
  menu?: MenuItem[];
  /** Kebab accessible name; defaults to `common:ui.openMenu`. */
  menuLabel?: string;
  /** Left border accent classes (waiting/active), or "" for none. */
  accent: string;
  badge: ReactNode;
  name: ReactNode;
  subtitle?: string | null;
  /** Tooltip for `subtitle`; omit for callers that don't need one. */
  subtitleTitle?: string;
  chip?: ReactNode;
  progress?: ReactNode;
  ts: string;
}

/** One-line Clickable row shared by AgentCard and SessionCard's `variant="row"`. */
export function CompactRow({
  to,
  onActivate,
  menu,
  menuLabel,
  accent,
  badge,
  name,
  subtitle,
  subtitleTitle,
  chip,
  progress,
  ts,
}: CompactRowProps) {
  return (
    <Clickable
      to={to}
      onActivate={onActivate}
      menu={menu}
      kebab={false}
      className={`group flex items-center gap-1.5 min-w-0 px-2 py-1.5 rounded-md hover:bg-surface-3 transition-colors ${accent}`}
    >
      {badge}
      <span className="flex-1 min-w-[4rem] text-sm font-medium text-gray-200 truncate">{name}</span>
      {subtitle && (
        <span
          className="max-w-[30%] text-[11px] text-gray-500 truncate hidden sm:inline"
          title={subtitleTitle}
        >
          {subtitle}
        </span>
      )}
      {chip}
      {progress}
      <time
        dateTime={ts}
        title={formatDateTimeFull(ts)}
        className="ml-auto text-[11px] text-gray-600 flex-shrink-0"
      >
        {timeAgo(ts)}
      </time>
      {menu && <MenuButton size="xs" items={menu} label={menuLabel} className="shrink-0" reveal />}
    </Clickable>
  );
}
