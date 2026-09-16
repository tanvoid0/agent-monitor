/**
 * @file EventRow.tsx
 * @description One event row shared by the Activity feed and the session
 * timeline: a `Clickable` (whole-row click toggles, right-click / kebab opens
 * the event menu) holding the expander button as the single primary control,
 * the caller's time cell, the status badge, the caller's origin chips followed
 * by `buildEventTitle`, the tool chip and any trailing controls. The expanded
 * `EventDetail` panel stays with the caller, rendered below this row.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Clickable, type MenuItem } from "./ui";
import { EntityRef } from "./entity";
import { AgentStatusBadge } from "./StatusBadge";
import { buildEventTitle, statusFromEventType } from "../lib/event-grouping";
import type { DashboardEvent } from "../lib/types";

export interface EventRowProps {
  event: DashboardEvent;
  /** Session the tool chip links into (the feed uses `event.session_id`). */
  sessionId: string;
  isOpen: boolean;
  onToggle: () => void;
  menu?: MenuItem[];
  /** Accessible label for the row's kebab menu button (e.g. "More actions for {name}"). */
  menuLabel?: string;
  /** Deep-link anchor (`event-<id>`) and tab-order override for the row container. */
  id?: string;
  tabIndex?: number;
  /** Timestamp cell rendered between the expander and the status badge. */
  time: ReactNode;
  /** Project / session / agent chips (with trailing separator) rendered before the title. */
  origin?: ReactNode;
  /** Keep the tool chip out of tab order; defaults to EntityRef's `true`. */
  toolTabbable?: boolean;
  /** Controls after the tool chip, e.g. the feed's "View session" link. */
  trailing?: ReactNode;
  className?: string;
}

export function EventRow({
  event,
  sessionId,
  isOpen,
  onToggle,
  menu,
  menuLabel,
  id,
  tabIndex,
  time,
  origin,
  toolTabbable,
  trailing,
  className = "flex items-center px-5 py-3.5 gap-4 hover:bg-surface-4 transition-colors select-none",
}: EventRowProps) {
  const { t } = useTranslation("common");
  return (
    <Clickable
      id={id}
      tabIndex={tabIndex}
      onActivate={onToggle}
      menu={menu}
      menuLabel={menuLabel}
      className={className}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={isOpen ? t("eventDetail.collapse") : t("eventDetail.expand")}
        className="flex items-center justify-center w-6 h-6 -m-1 -mr-2.5 rounded text-gray-500 hover:text-gray-300 flex-shrink-0"
      >
        <ChevronRight
          aria-hidden
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
      </button>

      {time}

      <AgentStatusBadge status={statusFromEventType(event.event_type)} />

      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 truncate">
          {origin}
          {buildEventTitle(event)}
        </p>
      </div>

      {event.tool_name && (
        <EntityRef
          kind="tool"
          name={event.tool_name}
          sessionId={sessionId}
          tabbable={toolTabbable}
          className="px-2 py-0.5 bg-surface-2 rounded text-gray-500 flex-shrink-0"
        />
      )}

      {trailing}
    </Clickable>
  );
}
