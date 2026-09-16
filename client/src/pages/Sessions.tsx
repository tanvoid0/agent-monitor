/**
 * @file Sessions.tsx
 * @description Displays all recorded sessions with searchable multi-project,
 * status, text, and custom sort filters plus server-side pagination. Status
 * and project filters live in the URL (`?status=`, repeated `?cwd=`; `?q=`
 * seeds the search box). Rows are Clickable table rows with an EntityRef
 * session name, project / model chips and a per-row entity menu; they can show
 * an accessible task-progress donut beside status and the local transient
 * Codex startup row before its durable session id exists.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/Claude-Code-Agent-Monitor/client/src/pages/Sessions.tsx`
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
 * - `../components/StatusBadge`
 * - `../components/EmptyState`
 * - `../components/Skeleton`
 * - `../lib/format`
 * - `../lib/types`
 *
 * ## Public surface
 * - `Sessions` — exported API; see TSDoc on the symbol for behavior.
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
 * **Sessions**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { FolderOpen, Search, RefreshCw, SortDesc, SortAsc, Play, Server } from "lucide-react";
import { api } from "../lib/api";
import type { RemoteSource } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { isRemoteDataRefreshMessage } from "../lib/remoteDataEvents";
import { useDataScope } from "../lib/dataScope";
import { SessionStatusBadge } from "../components/StatusBadge";
import { TodoProgressIndicator } from "../components/TodoProgressIndicator";
import { EmptyState } from "../components/EmptyState";
import { TableRowSkeleton } from "../components/Skeleton";
import { MultiSelect } from "../components/MultiSelect";
import { Select } from "../components/Select";
import { useUrlTab } from "../hooks/usePageShortcuts";
import { usePaletteAction } from "../components/PaletteActionProvider";
import { PaletteHint } from "../components/PaletteHint";
import {
  Badge,
  Button,
  Clickable,
  IconButton,
  MenuButton,
  PageHeader,
  SegmentedControl,
} from "../components/ui";
import { EntityRef, entityMenu } from "../components/entity";
import { copyText } from "../lib/clipboard";
import { routes } from "../lib/routes";
import {
  formatDateTime,
  formatDuration,
  formatModelName,
  fmtCost,
  isTransientProcess,
} from "../lib/format";
import {
  effectiveSessionStatus,
  isSessionAwaitingInput,
  sessionAwaitingReason,
} from "../lib/types";
import type { Session, DashboardEvent } from "../lib/types";

const PAGE_SIZE = 10;
type SessionSort = "time" | "duration" | "price";

const isTransientProcessSession = (session: Session) => isTransientProcess(session.metadata);

/** Status filters in render order — also the order `1`…`6` addresses them.
 *  `""` is the "all" pseudo-filter the server treats as no status constraint. */
const SESSION_FILTERS = ["", "active", "waiting", "completed", "error", "abandoned"] as const;

export function Sessions() {
  const { t } = useTranslation("sessions");
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  // The status filter lives in the URL so the command palette (and any shared
  // link) can open the list already narrowed. `""` is "all", which the hook
  // treats as a valid value like any other.
  const [filter, setFilter] = useUrlTab(SESSION_FILTERS, "", { param: "status" });
  // `searchInput` is what the user types; `search` is the debounced value
  // actually sent to the server. Without debouncing, every keystroke would
  // hit /api/sessions.
  // `?q=` seeds the box so a shared link opens the list already searched.
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(() => (searchParams.get("q") ?? "").trim());
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  // Project filter lives in the URL as repeated `?cwd=` params (paths may
  // contain commas) so the palette's project jump and EntityRef(project) links
  // land on a filtered list. Written back with `replace` so Back walks pages,
  // not filter states. Memoised on the joined value: `getAll` returns a fresh
  // array per render and `load` keys off it.
  const cwdKey = searchParams.getAll("cwd").join("\0");
  const cwds = useMemo(() => (cwdKey ? cwdKey.split("\0") : []), [cwdKey]);
  const setCwds = useCallback(
    (next: string[]) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          params.delete("cwd");
          for (const cwd of next) params.append("cwd", cwd);
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [sortBy, setSortBy] = useState<SessionSort>("time");
  const [sortDesc, setSortDesc] = useState(true);
  const [directories, setDirectories] = useState<string[]>([]);
  // Global data scope (which source machines to show). Included in `load`'s deps
  // so switching scope re-fetches; the actual `sources` param is injected by the
  // api layer (see lib/api.ts applyScope).
  const [scope] = useDataScope();
  // source id → label, so remote-origin rows show a friendly badge.
  const [sourceLabels, setSourceLabels] = useState<Map<string, string>>(() => new Map());
  // Set of session IDs that are currently being driven by an in-flight Run
  // handle on /run. Lets us badge those rows with a "Run" link.
  const [dashboardRunIds, setDashboardRunIds] = useState<Set<string>>(new Set());

  // Keyed off SESSION_FILTERS so the buttons, the `1`…`6` shortcuts, and the
  // `?status=` values can never fall out of order with one another.
  const FILTER_LABELS: Record<(typeof SESSION_FILTERS)[number], string> = {
    "": t("filterAll"),
    active: t("filterActive"),
    waiting: t("filterWaiting"),
    completed: t("filterCompleted"),
    error: t("filterError"),
    abandoned: t("filterAbandoned"),
  };
  // Radix ToggleGroup treats `""` as "nothing selected", so the "all" pseudo-
  // filter travels as `"all"` inside the control and maps back at the edge.
  const FILTER_OPTIONS = SESSION_FILTERS.map((value) => ({
    value: value || "all",
    label: FILTER_LABELS[value],
  }));

  // Debounce the search input → 300 ms after the user stops typing, the
  // committed value flips and triggers a fresh fetch.
  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    api.sessions
      .facets()
      .then((res) => {
        setDirectories(res.cwds);
      })
      .catch(console.error);
  }, []);

  // Load remote-source labels so remote-origin rows can show a friendly badge
  // instead of a raw `src_…` id. Refreshed when a source's status changes.
  const loadSourceLabels = useCallback(() => {
    api.remoteSources
      .list()
      .then((res: { sources: RemoteSource[] }) => {
        setSourceLabels(new Map(res.sources.map((s) => [s.id, s.label])));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadSourceLabels();
  }, [loadSourceLabels]);

  // Server-side pagination: only the visible page is fetched. Cost
  // computation on the server scales with PAGE_SIZE, not with the total
  // session count, so this stays cheap regardless of how many sessions
  // exist in the database.
  const load = useCallback(async () => {
    try {
      // Waiting is a presentation state over active sessions, so preserve the
      // existing client-side filter without expanding the server status enum.
      if (filter === "waiting") {
        const res = await api.sessions.list({
          status: "active",
          q: search || undefined,
          cwd: cwds.length > 0 ? cwds : undefined,
          sort_by: sortBy,
          sort_desc: sortDesc,
          include_transient: page === 0,
          include_task_progress: true,
          limit: 10000,
          offset: 0,
        });
        const waiting = res.sessions.filter(isSessionAwaitingInput);
        setTotal(waiting.length);
        setSessions(waiting.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
        return;
      }
      const params: {
        status?: string;
        q?: string;
        cwd?: string[];
        sort_by?: SessionSort;
        sort_desc?: boolean;
        include_transient?: boolean;
        include_task_progress?: boolean;
        limit: number;
        offset: number;
      } = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort_by: sortBy,
        sort_desc: sortDesc,
        include_transient: page === 0,
        include_task_progress: true,
      };
      if (filter) params.status = filter;
      if (search) params.q = search;
      if (cwds.length > 0) params.cwd = cwds;
      const res = await api.sessions.list(params);
      setSessions(res.sessions);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
    // `scope` is a dep so a data-scope change re-fetches; the api layer injects
    // the matching `sources` param.
  }, [filter, search, cwds, sortBy, sortDesc, page, scope]);

  usePaletteAction("page.refresh", () => {
    void load();
  });
  usePaletteAction("sessions.sortTime", () => setSortBy("time"));
  usePaletteAction("sessions.sortDuration", () => setSortBy("duration"));
  usePaletteAction("sessions.sortCost", () => setSortBy("price"));
  usePaletteAction("sessions.toggleSortDirection", () => setSortDesc((prev) => !prev));
  usePaletteAction("sessions.clearFilters", () => {
    setSearchInput("");
    // One URL write: two functional setSearchParams calls in the same tick
    // both derive from the render-time params, so the second would restore
    // the `status` the first removed.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("status");
        next.delete("cwd");
        return next;
      },
      { replace: true }
    );
  });

  useEffect(() => {
    load();
  }, [load]);

  // Reset to page 0 whenever filters or sort changes.
  useEffect(() => {
    setPage(0);
  }, [filter, search, cwds, sortBy, sortDesc]);

  useEffect(() => {
    // Trailing throttle: session_updated arrives on nearly every hook event
    // from every active session, and each un-throttled load() is an expensive
    // include_task_progress request server-side. Collapse bursts to at most
    // one load per window; the trailing call keeps the list current.
    const THROTTLE_MS = 2_000;
    const throttleRef = { timer: null as ReturnType<typeof setTimeout> | null, lastRun: 0 };
    const scheduleLoad = () => {
      if (throttleRef.timer) return; // trailing run already scheduled
      const wait = Math.max(0, THROTTLE_MS - (Date.now() - throttleRef.lastRun));
      throttleRef.timer = setTimeout(() => {
        throttleRef.timer = null;
        throttleRef.lastRun = Date.now();
        load();
      }, wait);
    };
    const unsubscribe = eventBus.subscribe((msg) => {
      if (msg.type === "session_created" || msg.type === "session_updated") {
        scheduleLoad();
      }
      if (msg.type === "new_event") {
        const ev = msg.data as DashboardEvent;
        if (
          ev.event_type === "Stop" ||
          ev.event_type === "SessionEnd" ||
          ev.event_type === "TaskCreated" ||
          ev.event_type === "TaskCompleted" ||
          ["TaskCreate", "TaskGet", "TaskUpdate", "TaskList", "TodoWrite", "update_plan"].includes(
            ev.tool_name || ""
          )
        ) {
          scheduleLoad();
        }
      }
      if (msg.type === "run_status") {
        loadDashboardRuns();
      }
      // A remote source finished syncing: new remote sessions may have landed.
      if (msg.type === "remote_source.status") {
        loadSourceLabels();
        if (isRemoteDataRefreshMessage(msg)) scheduleLoad();
      } else if (isRemoteDataRefreshMessage(msg)) {
        scheduleLoad();
      }
    });
    return () => {
      unsubscribe();
      // Drop any pending trailing reload: after cleanup its closure is stale
      // (old filters/scope) and its response could overwrite newer state.
      if (throttleRef.timer) clearTimeout(throttleRef.timer);
    };
    // loadDashboardRuns is a stable useCallback declared below; referenced at
    // event time only (not in deps) to avoid a temporal-dead-zone at render.
  }, [load, loadSourceLabels]);

  // Pull active Run handles so we can mark which sessions are being driven
  // from /run right now. Refresh on mount, on run_status WS messages, and
  // every 15s as a safety net for stale browser state.
  const loadDashboardRuns = useCallback(() => {
    api.run
      .list()
      .then((r) => {
        const ids = new Set<string>();
        for (const h of r.items) {
          if (h.sessionId) ids.add(h.sessionId);
        }
        setDashboardRunIds(ids);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadDashboardRuns();
    const t = setInterval(loadDashboardRuns, 15000);
    return () => clearInterval(t);
  }, [loadDashboardRuns]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // The server already paginates, so the rendered page IS the loaded list.
  const paged = sessions;
  const filtered = sessions; // kept for empty-state checks below
  const displayedTotal =
    total + (filter === "waiting" ? 0 : sessions.filter(isTransientProcessSession).length);

  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);
  const SORT_OPTIONS: Array<{ label: string; value: SessionSort }> = [
    { label: t(sortDesc ? "sortTimeNewest" : "sortTimeOldest"), value: "time" },
    { label: t(sortDesc ? "sortDurationLongest" : "sortDurationShortest"), value: "duration" },
    { label: t(sortDesc ? "sortPriceHighest" : "sortPriceLowest"), value: "price" },
  ];

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <PageHeader
          icon={FolderOpen}
          title={t("title")}
          live={wsConnected}
          subtitle={
            <span aria-live="polite" aria-atomic="true">
              {t("sessionCount", { count: displayedTotal })}
              {filter ? ` ${filter}` : ""}
            </span>
          }
          actions={
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void load()}>
              {t("common:refresh")}
            </Button>
          }
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 mb-6 bg-surface-2/40 p-2 rounded-xl border border-border w-full">
        {/* Search */}
        {/* The floor is sized so the field still fits its placeholder alongside
            the ⌘K chip. A viewport breakpoint cannot express this — the field's
            width comes from the space the toolbar has left, not the window — so
            the constraint lives on the field itself, and the row wraps rather
            than truncating "Search sessions…" to "Search ses". */}
        <div className="relative flex-1 min-w-[260px] max-w-[340px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            ref={searchRef}
            type="text"
            aria-label={t("searchPlaceholder")}
            placeholder={t("searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input w-full pl-10 pr-12"
          />
          <PaletteHint variant="absolute" />
        </div>

        {/* Directory Selector */}
        <div className="w-full shrink-0 sm:w-[280px] lg:w-[300px]">
          <MultiSelect
            label={t("directoryFilterLabel")}
            options={directories.map((directory) => ({ value: directory, label: directory }))}
            value={cwds}
            onChange={setCwds}
            allLabel={t("allDirectories")}
            selectedCountLabel={(count) => t("selectedDirectories", { count })}
            searchPlaceholder={t("directorySearchPlaceholder")}
            emptyLabel={t("noDirectoriesFound")}
            clearLabel={t("clearDirectories")}
          />
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-1.5 bg-surface-1 px-1.5 py-1 rounded-lg border border-border h-[38px] flex-1 min-w-[180px]">
          <div className="flex-1">
            <Select<SessionSort> value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} />
          </div>
          <div className="w-px h-4 bg-border mx-1" />
          <IconButton
            icon={sortDesc ? SortDesc : SortAsc}
            label={sortDesc ? t("sortDescending") : t("sortAscending")}
            aria-pressed={sortDesc}
            onClick={() => setSortDesc(!sortDesc)}
            className="shrink-0"
          />
        </div>

        {/* Status Filters — six pills that together outrun the toolbar on a
            narrow window. `shrink-0` made the group refuse to yield, so it spilled
            past the toolbar's rounded edge; it now caps at the space left over and
            scrolls inside itself, with the pills kept at full size so none of them
            compress into an unreadable sliver. */}
        <SegmentedControl
          size="sm"
          ariaLabel={t("statusFilterLabel")}
          items={FILTER_OPTIONS}
          value={filter || "all"}
          onValueChange={(value) =>
            setFilter(value === "all" ? "" : (value as (typeof SESSION_FILTERS)[number]))
          }
          className="ml-auto min-w-0 max-w-full overflow-x-auto no-scrollbar bg-surface-1 p-1"
        />
      </div>

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={t("noSessions")}
          description={
            search || filter || cwds.length > 0 ? t("noSessionsDesc") : t("noSessionsHint")
          }
        />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableSession")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableStatus")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableLastActive")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableDuration")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableAgents")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableCost")}
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    {t("tableDirectory")}
                  </th>
                  <th className="w-10">
                    <span className="sr-only">{t("common:actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && paged.length === 0
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TableRowSkeleton
                        key={`sk-${i}`}
                        columns={8}
                        widths={["w-40", "w-20", "w-28", "w-20", "w-10", "w-16", "w-44", "w-4"]}
                      />
                    ))
                  : null}
                {paged.map((session) => {
                  const transient = isTransientProcessSession(session);
                  const menu = transient
                    ? undefined
                    : entityMenu(
                        {
                          kind: "session",
                          id: session.id,
                          name: session.name,
                          cwd: session.cwd,
                          source: session.source,
                        },
                        { t, copy: copyText }
                      );
                  return (
                    <Clickable
                      as="tr"
                      key={session.id}
                      to={transient ? undefined : routes.session(session.id)}
                      menu={menu}
                      kebab={false}
                      className="hover:bg-surface-4 transition-colors group"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-200 truncate">
                              <EntityRef
                                kind="session"
                                id={session.id}
                                name={session.name}
                                cwd={session.cwd}
                                source={session.source}
                                transient={transient}
                                mono={false}
                                className="text-sm font-medium text-gray-200"
                              />
                            </p>
                            <p className="text-[11px] text-gray-600 font-mono truncate">
                              {session.id.slice(0, 12)}
                              {session.model && !transient && (
                                <>
                                  {" · "}
                                  <EntityRef
                                    kind="model"
                                    model={session.model}
                                    className="text-gray-500"
                                    tabbable={false}
                                  >
                                    {formatModelName(session.model)}
                                  </EntityRef>
                                </>
                              )}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {session.source && session.source !== "local" && (
                              <Badge
                                tone="info"
                                size="xs"
                                icon={Server}
                                title={t(
                                  "remoteSourceBadgeTitle",
                                  "Collected from a remote machine"
                                )}
                              >
                                {sourceLabels.get(session.source) || session.source}
                              </Badge>
                            )}
                            {dashboardRunIds.has(session.id) && (
                              <Link
                                to={routes.run({ session: session.id })}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 hover:text-emerald-200 px-1.5 py-0.5 rounded-full transition-colors"
                                title={t("dashboardRunBadge", "Driven by Run page · click to open")}
                              >
                                <Play className="w-2.5 h-2.5" />
                                {t("common:dashboardRun", "Run")}
                              </Link>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <SessionStatusBadge
                            status={effectiveSessionStatus(session)}
                            reason={sessionAwaitingReason(session)}
                            provider={session.provider}
                          />
                          {session.todo_summary && (
                            <TodoProgressIndicator progress={session.todo_summary} />
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-400">
                        {formatDateTime(session.last_activity || session.started_at)}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-400 font-mono">
                        {session.ended_at
                          ? formatDuration(session.started_at, session.ended_at)
                          : t("common:running")}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-400">
                        {session.agent_count != null && !transient ? (
                          <Link
                            to={routes.session(session.id, { tab: "agents" })}
                            title={t("detail.agents")}
                            className="hover:text-gray-200 hover:underline decoration-dotted underline-offset-2"
                          >
                            {session.agent_count}
                          </Link>
                        ) : (
                          (session.agent_count ?? "-")
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-400 font-mono">
                        {session.cost != null && session.cost > 0 ? fmtCost(session.cost) : "-"}
                      </td>
                      <td className="px-5 py-4 text-[11px] text-gray-500 font-mono max-w-[16rem]">
                        {session.cwd ? (
                          <EntityRef
                            kind="project"
                            cwd={session.cwd}
                            source={session.source}
                            className="text-gray-500"
                            tabbable={false}
                          />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-4">
                        {menu && (
                          <MenuButton
                            size="xs"
                            items={menu}
                            label={t("common:ui.openMenuFor", {
                              name: session.name?.trim() || session.id.slice(0, 8),
                            })}
                            reveal
                          />
                        )}
                      </td>
                    </Clickable>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
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
                  variant="secondary"
                  size="xs"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  {t("common:pagination.previous")}
                </Button>
                <span className="px-3 py-1.5 text-xs text-gray-500">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  {t("common:pagination.next")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
