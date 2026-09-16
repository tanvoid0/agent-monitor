/**
 * @file KanbanBoard.tsx
 * @description Kanban-style board with two views: agents grouped by their
 * AgentStatus (working/waiting/completed/error) or sessions grouped
 * by their SessionStatus (active/completed/error/abandoned). The view toggle
 * (`?view=`) and card density (`?density=cards|rows`) are persisted in
 * localStorage so the user's choice survives reloads. A strip of project tabs
 * (`?project=<group root>` — a raw cwd folds onto its root, "All projects" by
 * default) narrows either board to one project group, every card carries a
 * colour-keyed project badge, and each column's count links to the sessions
 * list pre-filtered by that status and project. Each column paginates
 * client-side at COLUMN_PAGE_SIZE.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/Claude-Code-Agent-Monitor/client/src/pages/KanbanBoard.tsx`
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
 * - `../components/AgentCard`
 * - `../components/SessionCard`
 * - `../components/EmptyState`
 * - `../components/Skeleton`
 * - `../lib/types`
 *
 * ## Public surface
 * - `KanbanBoard` — exported API; see TSDoc on the symbol for behavior.
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
 * **KanbanBoard**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useEffect, useState, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { RefreshCw, Columns3, ChevronDown, HelpCircle, Layers } from "lucide-react";
import { api } from "../lib/api";
import { useUrlTab } from "../hooks/usePageShortcuts";
import { usePaletteAction } from "../components/PaletteActionProvider";
import { useDataScope } from "../lib/dataScope";
import { eventBus } from "../lib/eventBus";
import { isRemoteDataRefreshMessage } from "../lib/remoteDataEvents";
import { AgentCard } from "../components/AgentCard";
import { SessionCard } from "../components/SessionCard";
import { projectRoots, projectLabel, projectColor } from "../components/ProjectBadge";
import { EmptyState } from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import { Badge, Button, PageHeader, SegmentedControl } from "../components/ui";
import { routes } from "../lib/routes";
import {
  STATUS_CONFIG,
  SESSION_STATUS_CONFIG,
  isAgentAwaitingInput,
  isSessionAwaitingInput,
} from "../lib/types";
import type {
  Agent,
  AgentStatus,
  EffectiveAgentStatus,
  EffectiveSessionStatus,
  Session,
  WSMessage,
} from "../lib/types";

/** Board views in render order — also the order `1`/`2` and `[`/`]` address them. */
const BOARD_VIEWS = ["agents", "sessions"] as const;
type BoardView = (typeof BOARD_VIEWS)[number];
/** Card densities: the full card or a one-line row. */
const DENSITIES = ["cards", "rows"] as const;

// Persisted statuses we fetch from the API.
const AGENT_FETCH_STATUSES: AgentStatus[] = ["working", "waiting", "completed", "error"];

// Columns rendered on the Agents board.
const AGENT_COLUMNS: EffectiveAgentStatus[] = ["working", "waiting", "completed", "error"];
const SESSION_COLUMNS: EffectiveSessionStatus[] = [
  "active",
  "waiting",
  "completed",
  "error",
  "abandoned",
];
const COLUMN_PAGE_SIZE = 10;
const VIEW_STORAGE_KEY = "kanban-board-view";

export function KanbanBoard() {
  const { t } = useTranslation("kanban");
  const [dataScope] = useDataScope();
  // URL-backed so the palette and shared links can open either board directly;
  // `kanban-board-view` still mirrors the last choice for an unqualified visit.
  const [view, setViewState] = useUrlTab(BOARD_VIEWS, "agents", {
    param: "view",
    storageKey: VIEW_STORAGE_KEY,
  });
  const [density, setDensity] = useUrlTab(DENSITIES, "cards", {
    param: "density",
    storageKey: "kanban-density",
  });
  const cardVariant = density === "rows" ? "row" : "card";
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  // `?project=<group root>` narrows both boards to one project group; absent
  // means every project in one place. URL-only (no localStorage) so a fresh
  // visit always starts from the whole picture.
  const [searchParams, setSearchParams] = useSearchParams();
  const project = searchParams.get("project") ?? "";
  const setProject = useCallback(
    (root: string) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (root) next.set("project", root);
          else next.delete("project");
          return next;
        },
        { replace: true }
      );
      setExpanded({});
    },
    [setSearchParams]
  );

  const setView = useCallback(
    (next: BoardView) => {
      setViewState(next);
      setExpanded({}); // reset per-column pagination when switching views
    },
    [setViewState]
  );

  const loadAgents = useCallback(async () => {
    // Fetch every persisted agent status. Bucketing happens below in
    // `groupedAgents`.
    //
    // Also fetch sessions so AgentCard can surface model / cwd / cost on
    // main-agent cards (they have no task and a generic name on their
    // own - the session metadata is what makes the card useful).
    const [agentResults, sessionsRes] = await Promise.all([
      Promise.all(
        AGENT_FETCH_STATUSES.map((status) =>
          api.agents.list({ status, include_transient: status === "waiting" })
        )
      ),
      api.sessions.list({ limit: 10000, include_transient: true }),
    ]);
    setAgents(agentResults.flatMap((r) => r.agents));
    setSessions(sessionsRes.sessions);
  }, [dataScope]);

  const loadSessions = useCallback(async () => {
    // Each column needs the full set for its status - column-level
    // pagination ("show more") is handled client-side at COLUMN_PAGE_SIZE.
    // Wire-limit raised to the server's safety cap (10000); cost
    // computation on the server scales with returned rows, so each
    // column's request stays bounded by how many sessions actually have
    // that status. The "waiting" column is derived client-side from the
    // active set (see grouping below).
    const persistedStatuses = SESSION_COLUMNS.filter((s) => s !== "waiting");
    const results = await Promise.all(
      persistedStatuses.map((status) =>
        api.sessions.list({
          status,
          limit: 10000,
          include_transient: status === "active",
        })
      )
    );
    setSessions(results.flatMap((r) => r.sessions));
  }, [dataScope]);

  const load = useCallback(async () => {
    try {
      if (view === "agents") await loadAgents();
      else await loadSessions();
    } finally {
      setLoading(false);
    }
  }, [view, loadAgents, loadSessions]);

  usePaletteAction("page.refresh", () => {
    void load();
  });

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    return eventBus.subscribe((msg: WSMessage) => {
      if (isRemoteDataRefreshMessage(msg)) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(load, 300);
        return;
      }
      if (view === "agents") {
        if (
          msg.type === "agent_created" ||
          msg.type === "agent_updated" ||
          msg.type === "session_updated" ||
          msg.type === "session_created"
        ) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(loadAgents, 300);
        }
      } else {
        if (msg.type === "session_created" || msg.type === "session_updated") {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(loadSessions, 300);
        }
      }
    });
  }, [view, loadAgents, loadSessions]);

  // Lookup map for AgentCard's session prop - memoized to avoid rebuilding on every render
  const sessionsById = useMemo(() => {
    const map = new Map<string, Session>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  // cwd → project group root (nested cwds and worktrees fold onto the shortest
  // known ancestor), shared by the tabs and every card's badge colour.
  const rootByCwd = useMemo(() => projectRoots(sessions.map((s) => s.cwd)), [sessions]);
  const rootOfSession = (s: Session | undefined) => (s?.cwd ? rootByCwd.get(s.cwd) : undefined);
  const rootOfAgent = (a: Agent) => rootOfSession(sessionsById.get(a.session_id));

  // One tab per group, counted in the active view and ordered by label so the
  // strip stays put as counts move.
  const projectCounts = new Map<string, number>();
  for (const root of rootByCwd.values()) projectCounts.set(root, 0);
  const bump = (root: string | undefined) => {
    if (root) projectCounts.set(root, (projectCounts.get(root) ?? 0) + 1);
  };
  if (view === "agents") agents.forEach((a) => bump(rootOfAgent(a)));
  else sessions.forEach((s) => bump(rootOfSession(s)));
  const projectTabs = [...projectCounts]
    .map(([root, count]) => ({ root, count, label: projectLabel(root) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.root.localeCompare(b.root));

  // `?project=` is a group root, but links from elsewhere may carry a raw cwd —
  // fold it onto its root. A value nobody has any more (stale link, purged data)
  // would leave an empty board with no tab selected — fall back to every
  // project instead.
  const activeProject = projectCounts.has(project) ? project : (rootByCwd.get(project) ?? "");
  // /api/sessions matches `cwd IN (...)` on the stored string, so links must
  // carry every raw cwd that folds onto the active root, not the root itself.
  const activeProjectCwds = activeProject
    ? [...new Set([...rootByCwd].filter(([, r]) => r === activeProject).map(([c]) => c))]
    : undefined;
  const visibleAgents = activeProject
    ? agents.filter((a) => rootOfAgent(a) === activeProject)
    : agents;
  const visibleSessions = activeProject
    ? sessions.filter((s) => rootOfSession(s) === activeProject)
    : sessions;

  // Bucket by effective status: agents with status "waiting" OR those with
  // awaiting_input_since set go into the "waiting" column. Other columns
  // exclude agents that belong in "waiting".
  const isEffectivelyWaiting = (a: Agent) => a.status === "waiting" || isAgentAwaitingInput(a);

  const groupedAgents = AGENT_COLUMNS.reduce(
    (acc, status) => {
      acc[status] =
        status === "waiting"
          ? visibleAgents.filter(isEffectivelyWaiting)
          : visibleAgents.filter((a) => a.status === status && !isEffectivelyWaiting(a));
      return acc;
    },
    {} as Record<EffectiveAgentStatus, Agent[]>
  );

  const groupedSessions = SESSION_COLUMNS.reduce(
    (acc, status) => {
      acc[status] =
        status === "waiting"
          ? visibleSessions.filter(isSessionAwaitingInput)
          : visibleSessions.filter((s) => s.status === status && !isSessionAwaitingInput(s));
      return acc;
    },
    {} as Record<EffectiveSessionStatus, Session[]>
  );

  const total = view === "agents" ? visibleAgents.length : visibleSessions.length;
  const subtitle =
    view === "agents"
      ? t("agentCount", { count: agents.length })
      : t("sessionCount", { count: sessions.length });

  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);

  const Header = (
    <div className="mb-8">
      <PageHeader
        icon={Columns3}
        title={t("title")}
        subtitle={subtitle}
        live={wsConnected}
        actions={
          <>
            <SegmentedControl
              size="sm"
              value={view}
              onValueChange={setView}
              ariaLabel={t("viewToggle.label")}
              items={BOARD_VIEWS.map((v) => ({ value: v, label: t(`viewToggle.${v}`) }))}
            />
            <SegmentedControl
              size="sm"
              value={density}
              onValueChange={setDensity}
              ariaLabel={t("density.label")}
              items={DENSITIES.map((d) => ({ value: d, label: t(`common:ui.density.${d}`) }))}
            />
            <Button variant="ghost" icon={RefreshCw} onClick={load} className="flex-shrink-0">
              {t("common:refresh")}
            </Button>
          </>
        }
      >
        {projectTabs.length > 0 && (
          <ProjectTabs
            tabs={projectTabs}
            active={activeProject}
            total={view === "agents" ? agents.length : sessions.length}
            onChange={setProject}
          />
        )}
      </PageHeader>
    </div>
  );

  if (!loading && total === 0) {
    return (
      <div className="animate-fade-in flex flex-col min-h-[60vh]">
        {Header}
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={Columns3}
            title={view === "agents" ? t("noAgents") : t("noSessions")}
            description={view === "agents" ? t("noAgentsDesc") : t("noSessionsDesc")}
            action={
              <Button variant="primary" icon={RefreshCw} onClick={load}>
                {t("common:refresh")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {Header}

      <div className="flex gap-4 min-h-[600px] overflow-x-auto pb-4 -mx-8 px-8">
        {view === "agents"
          ? AGENT_COLUMNS.map((status) => {
              const config = STATUS_CONFIG[status];
              const items = groupedAgents[status];
              const limit = expanded[status] || COLUMN_PAGE_SIZE;
              return (
                <Column
                  key={status}
                  labelKey={config.labelKey}
                  color={config.color}
                  dotClass={config.dot}
                  pulse={status === "working" || status === "waiting"}
                  count={items?.length ?? 0}
                  countHref={routes.sessions({
                    status: status === "working" ? "active" : status,
                    cwd: activeProjectCwds,
                  })}
                  countKind="agent"
                  emptyLabel={t("noAgentsInColumn")}
                  tooltip={t(`tooltip.agent.${status}`)}
                  remaining={Math.max(0, (items?.length ?? 0) - limit)}
                  onShowMore={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [status]: limit + COLUMN_PAGE_SIZE,
                    }))
                  }
                >
                  {loading && (items?.length ?? 0) === 0
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <CardSkeleton key={`sk-${status}-${i}`} />
                      ))
                    : items
                        ?.slice(0, limit)
                        .map((agent) => (
                          <AgentCard
                            key={agent.id}
                            variant={cardVariant}
                            agent={agent}
                            session={sessionsById.get(agent.session_id)}
                            projectRoot={rootOfAgent(agent)}
                          />
                        ))}
                </Column>
              );
            })
          : SESSION_COLUMNS.map((status) => {
              const config = SESSION_STATUS_CONFIG[status];
              const items = groupedSessions[status];
              const limit = expanded[status] || COLUMN_PAGE_SIZE;
              return (
                <Column
                  key={status}
                  labelKey={config.labelKey}
                  color={config.color}
                  dotClass={config.dot}
                  pulse={status === "active" || status === "waiting"}
                  count={items?.length ?? 0}
                  countHref={routes.sessions({ status, cwd: activeProjectCwds })}
                  countKind="session"
                  emptyLabel={t("noSessionsInColumn")}
                  tooltip={t(`tooltip.session.${status}`)}
                  remaining={Math.max(0, (items?.length ?? 0) - limit)}
                  onShowMore={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [status]: limit + COLUMN_PAGE_SIZE,
                    }))
                  }
                >
                  {loading && (items?.length ?? 0) === 0
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <CardSkeleton key={`sk-${status}-${i}`} />
                      ))
                    : items
                        ?.slice(0, limit)
                        .map((session) => (
                          <SessionCard
                            key={session.id}
                            variant={cardVariant}
                            session={session}
                            projectRoot={rootOfSession(session)}
                          />
                        ))}
                </Column>
              );
            })}
      </div>
    </div>
  );
}

interface ProjectTabsProps {
  tabs: { root: string; label: string; count: number }[];
  /** Active group root; `""` is the all-projects tab. */
  active: string;
  total: number;
  onChange: (root: string) => void;
}

/** "All projects" plus one chip per project group, colour-dotted to match the
 *  cards' badges. Scrolls horizontally rather than wrapping so the board keeps
 *  its height when a machine has dozens of projects. */
function ProjectTabs({ tabs, active, total, onChange }: ProjectTabsProps) {
  const { t } = useTranslation("kanban");
  const chip = (selected: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border whitespace-nowrap transition-colors ${
      selected
        ? "bg-accent/15 text-accent border-accent/30"
        : "border-border text-gray-400 hover:text-gray-200 hover:bg-surface-3"
    }`;
  return (
    <div
      role="tablist"
      aria-label={t("projects.all")}
      className="basis-full flex gap-1.5 overflow-x-auto pb-1 -mb-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === ""}
        onClick={() => onChange("")}
        className={chip(active === "")}
      >
        <Layers className="w-3 h-3" />
        {t("projects.all")}
        <Badge size="xs">{total}</Badge>
      </button>
      {tabs.map(({ root, label, count }) => (
        <button
          key={root}
          type="button"
          role="tab"
          aria-selected={active === root}
          onClick={() => onChange(root)}
          title={root}
          className={chip(active === root)}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${projectColor(root).dot}`} />
          {label}
          <Badge size="xs">{count}</Badge>
        </button>
      ))}
    </div>
  );
}

interface ColumnProps {
  labelKey: string;
  color: string;
  dotClass: string;
  pulse: boolean;
  count: number;
  /** Sessions list pre-filtered to this column (status + active project). */
  countHref: string;
  /** Which count noun the "view all" link's `count` refers to, for its
   *  accessible name (the link itself shows only the bare number). */
  countKind: "agent" | "session";
  emptyLabel: string;
  /** Multi-line description rendered in a tooltip when the user hovers
   *  the column's help icon. Pass an empty string to suppress the icon. */
  tooltip?: string;
  remaining: number;
  onShowMore: () => void;
  children: React.ReactNode;
}

function Column({
  labelKey,
  color,
  dotClass,
  pulse,
  count,
  countHref,
  countKind,
  emptyLabel,
  tooltip,
  remaining,
  onShowMore,
  children,
}: ColumnProps) {
  const { t } = useTranslation("kanban");
  const childrenArray = Array.isArray(children) ? children : children ? [children] : [];
  const hasChildren = childrenArray.length > 0;

  return (
    <div className="bg-surface-1 rounded-xl border border-border p-3 flex flex-col flex-shrink-0 w-72">
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className={`w-2 h-2 rounded-full ${dotClass} ${pulse ? "animate-pulse-dot" : ""}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${color}`}>
          {t(labelKey)}
        </span>
        {tooltip && <ColumnHelp text={tooltip} />}
        <Link
          to={countHref}
          aria-label={t(countKind === "agent" ? "columnCountLinkAgents" : "columnCountLink", {
            count,
            status: t(labelKey),
          })}
          className="ml-auto text-[11px] text-gray-400 hover:text-gray-200 bg-surface-3 px-2 py-0.5 rounded-full transition-colors"
        >
          {count}
        </Link>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto">
        {hasChildren ? (
          <>
            {children}
            {remaining > 0 && (
              <Button
                variant="ghost"
                size="xs"
                icon={ChevronDown}
                onClick={onShowMore}
                className="w-full text-[11px] text-gray-500"
              >
                {t("common:showMore", { count: remaining })}
              </Button>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-24 text-xs text-gray-600">
            {emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Help icon + tooltip for a Kanban column header. Hover or focus shows a
 * multi-line description explaining what the column lists and what the
 * status means in lifecycle terms. Keyboard-focusable for accessibility.
 */
function ColumnHelp({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  // Anchor positioning to the column header so the tooltip stays in-page on
  // the leftmost columns (where a centered tooltip would clip on narrow
  // viewports). We always anchor left-aligned to the trigger.
  const triggerRef = useRef<HTMLSpanElement>(null);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center cursor-help"
      tabIndex={0}
      role="img"
      aria-label={text}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <HelpCircle className="w-3 h-3 text-gray-500 hover:text-gray-300 transition-colors" />
      {show && (
        <span
          role="tooltip"
          className="absolute left-0 top-full mt-1.5 w-64 px-3 py-2 text-[11px] leading-relaxed text-gray-200 bg-surface-3 border border-border rounded-md shadow-xl z-50 pointer-events-none whitespace-pre-line"
        >
          {text}
        </span>
      )}
    </span>
  );
}
