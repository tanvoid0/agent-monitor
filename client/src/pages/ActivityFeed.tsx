/**
 * @file ActivityFeed.tsx
 * @description Real-time feed of agent events with server-driven filters and
 * batched pagination. Filters live in the URL (`?session_id=&agent_id=&
 * tool_name=&event_type=&status=` comma lists plus `q`/`from`/`to`) so deep
 * links and the palette share one source of truth. Each row is an `EventRow`
 * (whole-row click and chevron toggle the inline EventDetail payload view,
 * right-click / kebab for the event menu) with project / session / agent
 * rendered as `EntityRef` chips and a "View session" link into the timeline. Live events
 * trigger a debounced, filter-aware refetch that preserves the user's
 * accumulated page size.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/agent-monitor/client/src/pages/ActivityFeed.tsx`
 * **Purpose:** Dashboard module consumed by the React client, MCP tools, or desktop shell depending on deployment mode.
 *
 * ## Design constraints
 * - Local-first: no telemetry leaves the machine unless the user configures webhooks.
 * - Fail-safe hooks path on the server must never block Claude Code; UI mirrors that
 *   philosophy by degrading gracefully (empty states, stale badges, reconnect loops).
 * - Destructive flows stay behind explicit confirmation modals and server-side gates.
 * - Internationalization: user-visible strings belong in i18n JSON, not literals here.
 *
 * ## Remote data & SSH
 * Remote Data Sources let operators aggregate multiple machines. SSH entries describe
 * how to reach a peer dashboard; the global data scope (`dataScope.ts`) narrows every
 * scoped GET via `?sources=`. Health checks and import history surface in Settings.
 *
 * ## Observability
 * Prometheus scrapes `GET /api/metrics` (see `monitoring/`). Grafana ships four
 * provisioned boards (overview, sessions, tools, alerts). Native npm scripts and
 * Docker Compose profiles are documented in `monitoring/README.md`.
 *
 * ## Internal dependencies
 * - `../lib/api`
 * - `../lib/eventBus`
 * - `../lib/dataScope`
 * - `../components/EmptyState`
 * - `../components/EventDetail`
 * - `../components/EventRow`
 * - `../components/EventFilters`
 * - `../components/EventFiltersInfo`
 * - `../components/Skeleton`
 * - `../components/ui`, `../components/entity` (PageHeader, EntityRef)
 * - `../lib/routes`, `../lib/clipboard`
 * - `../lib/event-grouping`
 * - `../lib/format`
 * - `../lib/types`
 *
 * ## Public surface
 * - `ActivityFeed` — exported API; see TSDoc on the symbol for behavior.
 *
 * ## Testing pointers
 * - Prefer colocated `__tests__` with Vitest + Testing Library for UI.
 * - Server contract changes require `npm run test:server` and OpenAPI sync.
 * - MCP edits: `npm run mcp:typecheck` and `npm run mcp:build`.
 *
 * ## Related docs
 * - `ARCHITECTURE.md` — hooks → API → SQLite → WebSocket → UI pipeline.
 * - `docs/API.md` — REST reference.
 * - `.claude/skills/file-headers/` — mandatory `@author` header policy.
 * ============================================================================= */
/* -----------------------------------------------------------------------------
 * EXPORT CATALOG — quick index of symbols defined below (documentation only).
 * -----------------------------------------------------------------------------
 * **ActivityFeed**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useEffect, useState, useCallback, useRef, useMemo, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, Pause, Play, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "../lib/api";

import { usePaletteAction } from "../components/PaletteActionProvider";
import { eventBus } from "../lib/eventBus";
import { isRemoteDataRefreshMessage } from "../lib/remoteDataEvents";
import { useDataScope } from "../lib/dataScope";
import { EmptyState } from "../components/EmptyState";
import { EventDetail } from "../components/EventDetail";
import { EventRow } from "../components/EventRow";
import {
  EventFilters,
  EMPTY_FILTERS,
  isEmptyFilters,
  expandStatusToEventTypes,
} from "../components/EventFilters";
import type { EventFiltersValue } from "../components/EventFilters";
import { EventFiltersInfo } from "../components/EventFiltersInfo";
import { Skeleton } from "../components/Skeleton";
import { Button, PageHeader } from "../components/ui";
import { EntityRef, entityMenu } from "../components/entity";
import { copyText } from "../lib/clipboard";
import { routes } from "../lib/routes";
import { agentOriginLabel, agentTypeOf } from "../lib/event-grouping";
import type { AgentInfo } from "../lib/event-grouping";
import { formatTime, formatDateShort, timeAgo } from "../lib/format";
import type { DashboardEvent } from "../lib/types";

const PAGE_SIZE = 50;
// Max rows a single /api/events request can return (server cap). Refreshes
// triggered by live events are bounded by this.
const MAX_REFRESH = 500;
// Debounce live-event refreshes so a burst of hook events (e.g. a stream of
// PostToolUse results) triggers one refetch instead of dozens.
const REFRESH_DEBOUNCE_MS = 500;

// URL ⇄ filter state. List params are comma-joined (ids and tool names are
// comma-safe); `routes.activity` writes the same names.
const LIST_KEYS = ["session_id", "agent_id", "tool_name", "event_type", "status"] as const;
const TEXT_KEYS = ["q", "from", "to"] as const;

function parseFilters(sp: URLSearchParams): EventFiltersValue {
  const f: EventFiltersValue = { ...EMPTY_FILTERS };
  for (const k of LIST_KEYS)
    f[k] = sp
      .getAll(k)
      .flatMap((v) => v.split(","))
      .filter(Boolean);
  for (const k of TEXT_KEYS) f[k] = sp.get(k) ?? "";
  return f;
}

function serializeFilters(f: EventFiltersValue): URLSearchParams {
  const sp = new URLSearchParams();
  for (const k of LIST_KEYS) if (f[k].length > 0) sp.set(k, f[k].join(","));
  for (const k of TEXT_KEYS) if (f[k]) sp.set(k, f[k]);
  return sp;
}

/** Raw `cwd` from an event payload (`projectFromEvent` only exposes the basename). */
function cwdFromEvent(event: DashboardEvent): string | null {
  if (!event.data) return null;
  try {
    const cwd = (JSON.parse(event.data) as { cwd?: unknown } | null)?.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
  } catch {
    return null;
  }
}

export function ActivityFeed() {
  const { t } = useTranslation(["activity", "sessions"]);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  // The URL is the single source of truth for filters (deep links, palette).
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const setFilters = useCallback(
    (next: EventFiltersValue) => setSearchParams(serializeFilters(next), { replace: true }),
    [setSearchParams]
  );
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bufferCount, setBufferCount] = useState(0);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(() => new Set());
  // session_id → session name. Populated from /api/sessions on mount so rows
  // can render a friendly session pill instead of a bare UUID.
  const [sessionNameById, setSessionNameById] = useState<Map<string, string>>(() => new Map());
  // session_id → session cwd. Used as the leading origin chip for events whose
  // own payload carries no cwd (e.g. TurnDuration "Turn completed" rows), so
  // they match tool-use rows.
  const [sessionCwdById, setSessionCwdById] = useState<Map<string, string>>(() => new Map());
  // agent_id → subagent-facing info. Populated from /api/agents on mount so the
  // subagent pill can show subagent_type (e.g. "frontend-reviewer") instead of
  // a raw ID. Main agents intentionally yield no pill.
  const [agentInfoById, setAgentInfoById] = useState<Map<string, AgentInfo>>(() => new Map());

  const bufferRef = useRef<DashboardEvent[]>([]);
  const pausedRef = useRef(paused);
  // Refs let the websocket handler read the latest filter/page without
  // re-subscribing on every change.
  const apiParamsRef = useRef<Record<string, unknown>>({});
  const pageRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  pausedRef.current = paused;
  pageRef.current = page;

  function toggleEvent(id: number) {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Convert UI filter state → API params. Status presets expand into
  // event_type values and merge with any explicit event_type selection.
  const apiParams = useMemo(() => {
    const statusExpanded = expandStatusToEventTypes(filters.status);
    const eventTypeMerged = Array.from(new Set<string>([...filters.event_type, ...statusExpanded]));
    return {
      event_type: eventTypeMerged.length > 0 ? eventTypeMerged : undefined,
      tool_name: filters.tool_name.length > 0 ? filters.tool_name : undefined,
      agent_id: filters.agent_id.length > 0 ? filters.agent_id : undefined,
      session_id: filters.session_id.length > 0 ? filters.session_id : undefined,
      q: filters.q || undefined,
      from: filters.from ? new Date(filters.from).toISOString() : undefined,
      to: filters.to ? new Date(filters.to).toISOString() : undefined,
    };
  }, [filters]);

  apiParamsRef.current = apiParams;

  // Global data scope; a change re-runs `load` (api injects the `sources` param).
  const [scope] = useDataScope();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { events: data, total: totalCount } = await api.events.list({
        ...apiParams,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setEvents(data);
      setTotal(totalCount);
    } catch (err) {
      // Non-fatal: keep the previous list; log so dev tools surface the
      // failure instead of raising an unhandled promise rejection.
      console.error("Failed to load events:", err);
    } finally {
      setLoading(false);
    }
  }, [apiParams, page, scope]);

  usePaletteAction("page.refresh", () => {
    void load();
  });
  // Palette-only actions for the two controls that otherwise need the toolbar.
  usePaletteAction("activity.togglePause", () => (paused ? resume() : setPaused(true)));
  usePaletteAction("activity.clearFilters", () => setFilters(EMPTY_FILTERS));

  useEffect(() => {
    load();
  }, [load]);

  // Reset to page 0 whenever filters change so the user lands on the first
  // page of the new filtered result set.
  useEffect(() => {
    setPage(0);
  }, [apiParams]);

  useEffect(() => {
    let cancelled = false;
    // Mount-time name lookups: ask for the server's safety cap so even
    // long-running deployments get full pill coverage. These are one-shot
    // fetches; cost computation is bounded by returned rows but agents
    // don't have it and sessions only compute it on the page-sized list,
    // so this is cheap.
    api.sessions
      .list({ limit: 10000 })
      .then(({ sessions }) => {
        if (cancelled) return;
        const map = new Map<string, string>();
        const cwdMap = new Map<string, string>();
        for (const s of sessions) {
          // Always populate so the EventDetail panel's "Session" row shows
          // an identifiable label even for unnamed sessions. Matches the
          // fallback used by SessionDetail's header.
          const label = s.name?.trim() || `${t("sessions:defaultName")}${s.id.slice(0, 8)}`;
          map.set(s.id, label);
          if (s.cwd) cwdMap.set(s.id, s.cwd);
        }
        setSessionNameById(map);
        setSessionCwdById(cwdMap);
      })
      .catch(() => {
        // Non-fatal: rows just render without the session name pill.
      });
    api.agents
      .list({ limit: 10000 })
      .then(({ agents }) => {
        if (cancelled) return;
        const map = new Map<string, AgentInfo>();
        for (const a of agents) {
          map.set(a.id, {
            type: a.type,
            subagent_type: a.subagent_type,
            name: a.name,
            parent_agent_id: a.parent_agent_id,
          });
        }
        setAgentInfoById(map);
      })
      .catch(() => {
        // Non-fatal: subagent pills fall back to the short-id label.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refetches the current page using the latest filter state. Capped at
  // MAX_REFRESH (server limit); at the default PAGE_SIZE this is a no-op cap.
  const refreshWithPagination = useCallback(async () => {
    const size = Math.min(PAGE_SIZE, MAX_REFRESH);
    try {
      const { events: data, total: totalCount } = await api.events.list({
        ...apiParamsRef.current,
        limit: size,
        offset: pageRef.current * PAGE_SIZE,
      });
      setEvents(data);
      setTotal(totalCount);
    } catch (err) {
      // Non-fatal: swallow the error so a flaky websocket burst doesn't
      // spam unhandled rejections; the next live event / manual refresh
      // will try again.
      console.error("Failed to refresh events:", err);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = eventBus.subscribe((msg) => {
      // A remote source finished syncing → new remote events may exist; do a
      // filter-aware refresh (respects pause via refreshWithPagination's guard).
      if (isRemoteDataRefreshMessage(msg)) {
        if (!pausedRef.current) refreshWithPagination();
        return;
      }
      if (msg.type !== "new_event") return;
      const event = msg.data as DashboardEvent;
      if (pausedRef.current) {
        bufferRef.current = [event, ...bufferRef.current];
        setBufferCount(bufferRef.current.length);
        return;
      }
      // Debounce bursts into a single filter-aware refresh.
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        refreshWithPagination();
      }, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [refreshWithPagination]);

  function resume() {
    pausedRef.current = false;
    bufferRef.current = [];
    setBufferCount(0);
    setPaused(false);
    // Catch-up via filtered refresh so buffered non-matching events don't leak in.
    refreshWithPagination();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Precompute the raw cwd per event so row rendering doesn't re-parse
  // event.data JSON on every render pass.
  const cwdByEventId = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const e of events) map.set(e.id, cwdFromEvent(e));
    return map;
  }, [events]);

  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <PageHeader
          icon={Activity}
          title={t("title")}
          live={wsConnected}
          subtitle={
            <>
              {t("subtitle")}
              {paused && (
                <span className="ml-2 text-yellow-400">{t("paused", { count: bufferCount })}</span>
              )}
            </>
          }
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={paused ? Play : Pause}
                onClick={() => (paused ? resume() : setPaused(true))}
              >
                {paused ? t("resume") : t("pause")}
              </Button>
              <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void load()}>
                {t("common:refresh")}
              </Button>
            </>
          }
        />
      </div>

      <div className="mb-3">
        <EventFiltersInfo />
      </div>

      <div className="mb-4">
        <EventFilters
          value={filters}
          onChange={setFilters}
          sessionOptions={Array.from(sessionNameById.entries()).map(([id, label]) => ({
            id,
            label,
          }))}
        />
      </div>

      {!loading && events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={isEmptyFilters(filters) ? t("noActivity") : t("common:eventFilters.noResults")}
          description={isEmptyFilters(filters) ? t("noActivityDesc") : ""}
        />
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="divide-y divide-border max-h-[calc(100vh-260px)] min-h-[560px] overflow-y-auto overflow-x-auto">
              {loading && events.length === 0
                ? Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={`sk-${i}`}
                      className="flex items-center px-5 py-3.5 gap-4"
                      aria-busy="true"
                    >
                      <Skeleton className="w-3.5 h-3.5" rounded="sm" />
                      <Skeleton className="h-3 w-14" />
                      <Skeleton className="h-5 w-16" rounded="full" />
                      <Skeleton className="h-3 w-48 flex-shrink-0" />
                      <Skeleton className="h-3 flex-1" />
                    </div>
                  ))
                : null}
              {events.map((event, i) => {
                const isOpen = event.id != null && expandedEvents.has(event.id);
                const sessionHref = routes.session(event.session_id, { event: event.id });
                const cwd =
                  cwdByEventId.get(event.id) ?? sessionCwdById.get(event.session_id) ?? null;
                const agentLabel = agentOriginLabel(event.agent_id, agentInfoById);
                const agentType = agentTypeOf(event.agent_id ?? "", agentInfoById);
                const toggle = () => {
                  if (event.id != null) toggleEvent(event.id);
                };
                return (
                  <div key={event.id ?? i} className="animate-slide-up">
                    <EventRow
                      event={event}
                      sessionId={event.session_id}
                      isOpen={isOpen}
                      onToggle={toggle}
                      menu={entityMenu(
                        {
                          kind: "event",
                          id: event.id,
                          sessionId: event.session_id,
                          toolName: event.tool_name,
                          agentId: event.agent_id,
                        },
                        { t, copy: copyText }
                      )}
                      menuLabel={t("common:ui.openMenuFor", {
                        name:
                          agentLabel ?? sessionNameById.get(event.session_id) ?? event.session_id,
                      })}
                      time={
                        <div className="w-16 flex-shrink-0 text-right font-mono leading-tight">
                          <div className="text-[11px] text-gray-500">
                            {formatTime(event.created_at)}
                          </div>
                          <div className="text-[9px] text-gray-600">
                            {formatDateShort(event.created_at)}
                          </div>
                        </div>
                      }
                      origin={
                        <span className="text-gray-500 mr-1">
                          {cwd && (
                            <>
                              <EntityRef
                                kind="project"
                                cwd={cwd}
                                mono={false}
                                tabbable={false}
                                className="text-gray-500"
                              />
                              {" › "}
                            </>
                          )}
                          <EntityRef
                            kind="session"
                            id={event.session_id}
                            name={sessionNameById.get(event.session_id)}
                            cwd={cwd}
                            mono={false}
                            tabbable={false}
                            className="text-gray-500"
                          />
                          {event.agent_id && agentLabel && (
                            <>
                              {" › "}
                              <EntityRef
                                kind="agent"
                                id={event.agent_id}
                                sessionId={event.session_id}
                                type={agentType}
                                mono={false}
                                tabbable={false}
                                className="text-gray-500"
                              >
                                {agentLabel}
                              </EntityRef>
                            </>
                          )}
                          {" ·"}
                        </span>
                      }
                      toolTabbable={false}
                      trailing={
                        <>
                          <span className="text-[11px] text-gray-600 flex-shrink-0 w-16 text-right">
                            {timeAgo(event.created_at)}
                          </span>
                          <Link
                            to={sessionHref}
                            title={t("viewSession")}
                            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-surface-2 text-gray-400 hover:text-accent hover:bg-accent/10 border border-border hover:border-accent/30 transition-colors flex-shrink-0 font-medium"
                          >
                            {t("viewSession")}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        </>
                      }
                    />
                    {isOpen && (
                      <EventDetail
                        event={event}
                        agentInfoById={agentInfoById}
                        sessionNameById={sessionNameById}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {total > 0 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <span className="text-xs text-gray-500">
                {t("common:pagination.showing", {
                  from: page * PAGE_SIZE + 1,
                  to: Math.min((page + 1) * PAGE_SIZE, total),
                  total,
                })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="xs"
                  onClick={() => setPage(0)}
                  disabled={page === 0}
                  aria-label={t("firstPage")}
                >
                  «
                </Button>
                <Button
                  size="xs"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  {t("common:pagination.previous")}
                </Button>
                {(() => {
                  // Compact numbered page buttons: show up to 5 pages around
                  // the current page, with ellipses when appropriate.
                  const pages: (number | "...")[] = [];
                  const windowSize = 5;
                  let start = Math.max(0, page - Math.floor(windowSize / 2));
                  let end = Math.min(totalPages - 1, start + windowSize - 1);
                  start = Math.max(0, Math.min(start, end - windowSize + 1));
                  if (start > 0) {
                    pages.push(0);
                    if (start > 1) pages.push("...");
                  }
                  for (let i = start; i <= end; i++) pages.push(i);
                  if (end < totalPages - 1) {
                    if (end < totalPages - 2) pages.push("...");
                    pages.push(totalPages - 1);
                  }
                  return pages.map((p, idx) =>
                    p === "..." ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-2 py-1.5 text-xs text-gray-600 select-none"
                      >
                        ...
                      </span>
                    ) : (
                      <Button
                        key={p}
                        size="xs"
                        onClick={() => setPage(p)}
                        aria-current={p === page ? "page" : undefined}
                        className={`min-w-[32px] ${
                          p === page ? "bg-accent/20 text-accent border-accent/30" : ""
                        }`}
                      >
                        {p + 1}
                      </Button>
                    )
                  );
                })()}
                <Button
                  size="xs"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  {t("common:pagination.next")}
                </Button>
                <Button
                  size="xs"
                  onClick={() => setPage(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  aria-label={t("lastPage")}
                >
                  »
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
