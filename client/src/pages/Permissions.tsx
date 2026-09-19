/**
 * @file Permissions.tsx
 * @description Dedicated page for Claude Code permission prompts the relay is
 * holding. Each pending prompt is shown beside the session it came from — name,
 * status, project, the prompt that started the turn and the last few tool
 * calls — so the user can judge a request in context before answering it. The
 * answer buttons are the same `PermissionCard` the floating stack and the
 * session detail page use; all three share `usePermissionRelay`, so a decision
 * taken anywhere clears the prompt everywhere.
 *
 * Session context is fetched once per distinct session id and kept for the
 * page's lifetime; a prompt whose session the dashboard has never seen (a CLI
 * whose other hooks are not installed) still renders, just without context.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ShieldAlert, ShieldCheck, ArrowRight, Clock } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { routes } from "../lib/routes";
import { timeAgo } from "../lib/format";
import { buildEventSummary } from "../lib/event-summary";
import { effectiveSessionStatus, sessionAwaitingReason } from "../lib/types";
import type { DashboardEvent, PermissionRequest, Session } from "../lib/types";
import { usePermissionRelay } from "../hooks/usePermissionRelay";
import { PermissionCard } from "../components/PermissionCard";
import { ProjectBadge } from "../components/ProjectBadge";
import { SessionStatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/ui";

/** How many recent tool calls to show beside a prompt. */
const RECENT_TOOL_EVENTS = 6;

interface SessionContext {
  session: Session;
  /** Newest-first tool events, capped at RECENT_TOOL_EVENTS. */
  recent: DashboardEvent[];
}

/** `"loading"` while the fetch is in flight; `"missing"` when the dashboard has no such session. */
type ContextEntry = SessionContext | "loading" | "missing";

/** Fetch and cache `{session, recent tool events}` for every distinct session id. */
function useSessionContexts(pending: PermissionRequest[]): Record<string, ContextEntry> {
  const [contexts, setContexts] = useState<Record<string, ContextEntry>>({});
  const ids = useMemo(
    () => [...new Set(pending.map((p) => p.session_id).filter((s): s is string => !!s))],
    [pending]
  );

  useEffect(() => {
    for (const id of ids) {
      if (id in contexts) continue;
      // Mark in flight so a re-render mid-fetch does not fire it twice.
      setContexts((prev) => (id in prev ? prev : { ...prev, [id]: "loading" }));
      api.sessions
        .get(id)
        .then(({ session, events }) => {
          const recent = events
            .filter((e) => e.event_type === "PreToolUse" || e.event_type === "PostToolUse")
            .slice(0, RECENT_TOOL_EVENTS);
          setContexts((prev) => ({ ...prev, [id]: { session, recent } }));
        })
        .catch(() => {
          // The prompt still renders, just without context.
          setContexts((prev) => ({ ...prev, [id]: "missing" }));
        });
    }
    // `contexts` is intentionally not a dependency: it is the cache this
    // effect fills, and re-running on every fill would only re-check `in`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return contexts;
}

function SessionContextPanel({
  sessionId,
  context,
}: {
  sessionId: string | null;
  context: ContextEntry | undefined;
}) {
  const { t } = useTranslation("common");

  if (!sessionId) {
    return <p className="text-xs text-gray-500">{t("permissions.page.noSession")}</p>;
  }
  if (context === undefined || context === "loading") {
    return <p className="text-xs text-gray-500">{t("permissions.page.loadingSession")}</p>;
  }
  if (context === "missing") {
    return <p className="text-xs text-gray-500">{t("permissions.page.unknownSession")}</p>;
  }

  const { session, recent } = context;
  const status = effectiveSessionStatus(session);
  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0">
        <Link
          to={routes.session(session.id)}
          className="block truncate text-sm font-semibold text-gray-100 hover:text-accent"
          title={session.name ?? session.id}
        >
          {session.name ?? session.id}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <SessionStatusBadge
            status={status}
            reason={sessionAwaitingReason(session)}
            provider={session.provider}
            compact
          />
          {session.cwd && <ProjectBadge cwd={session.cwd} source={session.source} />}
          {session.model && (
            <span className="text-[11px] text-gray-500 font-mono">{session.model}</span>
          )}
        </div>
      </div>

      {session.prompt_preview && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            {t("permissions.page.lastPrompt")}
          </div>
          <p className="line-clamp-3 text-xs text-gray-300">{session.prompt_preview}</p>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            {t("permissions.page.recentTools")}
          </div>
          <ul className="flex flex-col gap-1">
            {recent.map((e) => {
              const summary = buildEventSummary(e);
              return (
                <li key={e.id} className="flex items-baseline gap-1.5 text-xs">
                  <span className="shrink-0" aria-hidden>
                    {summary?.icon ?? "•"}
                  </span>
                  <span className="min-w-0 truncate text-gray-300">
                    {summary?.headline ?? e.tool_name ?? e.event_type}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-gray-600">
                    {timeAgo(e.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Link
        to={routes.session(session.id, { tab: "timeline" })}
        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
      >
        {t("permissions.page.openSession")}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function Permissions() {
  const { t } = useTranslation("common");
  const { pending, busy, errors, decide } = usePermissionRelay();
  const contexts = useSessionContexts(pending);
  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);
  const [holdMs, setHoldMs] = useState<number | null>(null);

  useEffect(() => {
    api.permissions
      .list()
      .then((r) => setHoldMs(r.hold_ms))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ShieldAlert}
        title={t("permissions.title")}
        subtitle={
          pending.length
            ? t("permissions.page.subtitlePending", { count: pending.length })
            : t("permissions.page.subtitleIdle")
        }
        live={wsConnected}
      />

      {pending.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
            <ShieldCheck className="h-6 w-6 text-emerald-300" />
          </span>
          <div className="text-sm font-medium text-gray-200">
            {t("permissions.page.emptyTitle")}
          </div>
          <p className="max-w-md text-xs leading-relaxed text-gray-500">
            {t("permissions.page.emptyBody")}
          </p>
          {holdMs !== null && (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
              <Clock className="h-3 w-3" />
              {t("permissions.page.holdWindow", { seconds: Math.round(holdMs / 1000) })}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4" role="region" aria-label={t("permissions.title")}>
          {pending.map((req) => (
            <div
              key={req.id}
              className="card grid gap-5 border-amber-500/30 p-5 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]"
            >
              <PermissionCard
                req={req}
                disabled={busy === req.id}
                {...(errors[req.id] ? { error: errors[req.id] } : {})}
                onDecide={decide}
                context={false}
              />
              <aside className="border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                <SessionContextPanel
                  sessionId={req.session_id}
                  context={contexts[req.session_id ?? ""]}
                />
              </aside>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
