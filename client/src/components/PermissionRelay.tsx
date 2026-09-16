/**
 * @file Floating stack that lets the user answer Claude Code permission
 * prompts from anywhere in the dashboard. State and decisions come from
 * `usePermissionRelay`; each card is a `PermissionCard`.
 *
 * Prompts belonging to the session whose detail page is currently open are
 * skipped here, and nothing is shown on the dedicated /permissions page: both
 * render the same card inline, in context, and two copies of one prompt would
 * only make the user wonder whether answering one answers the other.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { usePermissionRelay } from "../hooks/usePermissionRelay";
import { PermissionCard } from "./PermissionCard";

/** The session id of an open `/sessions/:id` page, or null anywhere else. */
export function openSessionId(pathname: string): string | null {
  const match = /^\/sessions\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function PermissionRelay() {
  const { t } = useTranslation("common");
  const { pending, busy, errors, decide } = usePermissionRelay();
  const { pathname } = useLocation();

  // The dedicated page lists every prompt; the floating stack would only
  // duplicate it there.
  if (pathname === "/permissions") return null;

  const onScreenElsewhere = openSessionId(pathname);
  const cards = pending.filter((req) => req.session_id !== onScreenElsewhere);

  if (!cards.length) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-[80] flex w-[min(30rem,calc(100vw-2.5rem))] flex-col gap-3"
      role="region"
      aria-label={t("permissions.title")}
    >
      {cards.map((req) => (
        <PermissionCard
          key={req.id}
          req={req}
          disabled={busy === req.id}
          {...(errors[req.id] ? { error: errors[req.id] } : {})}
          onDecide={decide}
          className="card border-amber-500/40 bg-surface-3/95 p-4 shadow-2xl backdrop-blur animate-fade-in"
        />
      ))}
    </div>
  );
}
