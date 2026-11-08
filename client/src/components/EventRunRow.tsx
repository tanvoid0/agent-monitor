/**
 * @file EventRunRow.tsx
 * @description One collapsed "<type> x<n>" row for the "Group by tool call"
 * view, shared by Session Detail's Timeline tab and Activity Feed: a disclosure
 * button that expands to each underlying event, rendered by the caller's own
 * per-event markup via `renderEvent` (so time formatting, origin chips, and
 * menus stay exactly what each page already renders for a single event).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { DashboardEvent } from "../lib/types";

export interface EventRunRowProps {
  eventType: string;
  events: DashboardEvent[];
  renderEvent: (event: DashboardEvent, index: number) => ReactNode;
}

export function EventRunRow({ eventType, events, renderEvent }: EventRunRowProps) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation("common");
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-gray-500 hover:bg-surface-4 hover:text-gray-300 transition-colors"
      >
        <ChevronRight
          aria-hidden
          className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {/* eventType is a raw hook identifier (e.g. "TurnDuration") - never
            translated, same as elsewhere in the event surfaces. */}
        <span className="text-sm font-mono">{eventType}</span>
        <span className="text-xs text-gray-600">
          {t("eventFilters.groupEventCount", { count: events.length })}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {events.map(renderEvent)}
        </div>
      )}
    </div>
  );
}
