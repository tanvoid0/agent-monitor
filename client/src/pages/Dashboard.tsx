/**
 * @file Dashboard.tsx
 * @description Main dashboard page showing real-time stats, active agents with
 * session task-progress indicators, and recent activity for Claude and Codex.
 * Monitor/Health are Radix tabs under a shared PageHeader; the agent tree uses
 * one-line AgentCard rows and every activity row deep-links to its event with
 * session/tool EntityRef chips and an event context menu. The Health tab's
 * markup lives in `components/dashboard/SystemHealthTab.tsx`.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/agent-monitor/client/src/pages/Dashboard.tsx`
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
 * - `../components/StatCard`
 * - `../components/AgentCard`
 * - `../components/AgentTree`
 * - `../components/StatusBadge`
 * - `../components/EmptyState`
 * - `../components/Tip`
 * - `../lib/format`
 * - `../lib/event-grouping`
 * - `../lib/types`
 *
 * ## Public surface
 * - `Dashboard` — exported API; see TSDoc on the symbol for behavior.
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
 * **Dashboard**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useEffect, useState, useCallback, useSyncExternalStore, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  FolderOpen,
  Bot,
  Zap,
  DollarSign,
  Activity,
  ArrowRight,
  RefreshCw,
  GitBranch,
  CircleDot,
  Server,
} from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import { isRemoteDataRefreshMessage } from "../lib/remoteDataEvents";
import { useDataScope } from "../lib/dataScope";
import { StatCard } from "../components/StatCard";
import { AgentCard } from "../components/AgentCard";
import { AgentTree } from "../components/AgentTree";
import { AgentStatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { SystemHealthTab } from "../components/dashboard/SystemHealthTab";
import {
  Button,
  Clickable,
  PageHeader,
  SectionHeader,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui";
import { EntityRef, entityMenu } from "../components/entity";
import { copyText } from "../lib/clipboard";
import { routes } from "../lib/routes";
import { useUrlTab } from "../hooks/usePageShortcuts";
import { usePaletteAction } from "../components/PaletteActionProvider";
import { timeAgo, fmt, fmtCost } from "../lib/format";
import { activityStatusFromEvent } from "../lib/event-grouping";
import type { Stats, Agent, DashboardEvent, WSMessage, Session } from "../lib/types";

/** Tab keys in render order — also the order `1`/`2` and `[`/`]` address them. */
const DASHBOARD_TABS = ["monitor", "health"] as const;
type DashboardTab = (typeof DASHBOARD_TABS)[number];

export function Dashboard() {
  const { t } = useTranslation("dashboard");

  // Tab state lives in the URL so the command palette can address either view
  // directly; `dashboard_tab` still mirrors the last choice, so an unqualified
  // visit lands where the user left off.
  const [activeTab, setActiveTab] = useUrlTab(DASHBOARD_TABS, "monitor", {
    storageKey: "dashboard_tab",
  });

  const [stats, setStats] = useState<Stats | null>(null);
  const [activeAgents, setActiveAgents] = useState<Agent[]>([]);
  const [recentEvents, setRecentEvents] = useState<DashboardEvent[]>([]);
  const [totalCost, setTotalCost] = useState<number | null>(null);
  const [allSubagents, setAllSubagents] = useState<Agent[]>([]);
  const [sessionsById, setSessionsById] = useState<Map<string, Session>>(new Map());
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Dynamic item counts based on available container height
  const agentsContainerRef = useRef<HTMLDivElement>(null);
  const activityContainerRef = useRef<HTMLDivElement>(null);
  const [visibleAgentCount, setVisibleAgentCount] = useState(5);
  const [visibleActivityCount, setVisibleActivityCount] = useState(8);

  useEffect(() => {
    const AGENT_ROW_H = 44; // ~px per one-line agent row (36px row + 8px gap)
    const ACTIVITY_ROW_H = 44; // ~px per activity row
    const HEADER_H = 40; // section header height

    function recalc() {
      if (agentsContainerRef.current) {
        const h = agentsContainerRef.current.clientHeight;
        setVisibleAgentCount(Math.max(3, Math.floor((h - HEADER_H) / AGENT_ROW_H)));
      }
      if (activityContainerRef.current) {
        const h = activityContainerRef.current.clientHeight;
        setVisibleActivityCount(Math.max(3, Math.floor((h - HEADER_H) / ACTIVITY_ROW_H)));
      }
    }

    const ro = new ResizeObserver(recalc);
    if (agentsContainerRef.current) ro.observe(agentsContainerRef.current);
    if (activityContainerRef.current) ro.observe(activityContainerRef.current);
    recalc();

    return () => ro.disconnect();
  }, [activeTab]);

  // Global data scope; a change re-runs `load` (the API layer injects matching
  // source-machine and provider params into the calls below).
  const [scope] = useDataScope();

  const load = useCallback(async () => {
    try {
      const [statsRes, workingRes, waitingRes, eventsRes, costRes, sessionsRes] = await Promise.all(
        [
          api.stats.get(),
          api.agents.list({ status: "working", limit: 20 }),
          api.agents.list({ status: "waiting", limit: 20, include_transient: true }),
          api.events.list({ limit: 30 }),
          api.pricing.totalCost(),
          api.sessions.list({
            status: "active",
            limit: 100,
            include_transient: true,
            include_task_progress: true,
          }),
        ]
      );
      setStats(statsRes);
      const active = [...workingRes.agents, ...waitingRes.agents];
      setActiveAgents(active);
      setRecentEvents(eventsRes.events);
      setTotalCost(costRes.total_cost);
      setSessionsById(new Map(sessionsRes.sessions.map((s) => [s.id, s])));
      setError(null);

      // Fetch all subagents for each active main agent's session
      const activeSessionIds = [
        ...new Set(active.filter((a) => a.type === "main").map((a) => a.session_id)),
      ];
      const subagentResults = await Promise.all(
        activeSessionIds.map((sid) => api.agents.list({ session_id: sid, limit: 100 }))
      );
      const subs = subagentResults.flatMap((r) => r.agents).filter((a) => a.type === "subagent");
      setAllSubagents(subs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedLoad"));
    }
  }, [t, scope]);

  usePaletteAction("page.refresh", () => {
    void load();
  });

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  // Auto-expand agents with active subagents (walk up the full parent chain)
  useEffect(() => {
    const parentsWithActive = new Set<string>();
    for (const a of allSubagents) {
      if (a.parent_agent_id && a.status === "working") {
        parentsWithActive.add(a.parent_agent_id);
      }
    }
    if (parentsWithActive.size === 0) return; // No-op: skip state update entirely

    const subMap = new Map(allSubagents.map((a) => [a.id, a]));
    const toExpand = new Set<string>();
    for (const pid of parentsWithActive) {
      let cur = pid;
      while (cur) {
        toExpand.add(cur);
        const parent = subMap.get(cur);
        cur = parent?.parent_agent_id ?? "";
      }
    }
    setExpandedAgents((prev) => {
      // Only update if there are genuinely new IDs to add
      const newIds = [...toExpand].filter((id) => !prev.has(id));
      if (newIds.length === 0) return prev; // Stable reference - no re-render
      return new Set([...prev, ...newIds]);
    });
  }, [allSubagents]);

  useEffect(() => {
    // Trailing throttle, NOT a debounce: with several chatty sessions a
    // session_updated arrives on nearly every hook event, and a debounce that
    // re-arms per message either fires once per hook (>300ms apart) or starves.
    // Each reload is expensive server-side (task-progress recomputation), so
    // collapse bursts to at most one load per window; the trailing call keeps
    // the view eventually consistent and the 10s poll remains the backstop.
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
    const unsubscribe = eventBus.subscribe((msg: WSMessage) => {
      if (
        msg.type === "agent_created" ||
        msg.type === "agent_updated" ||
        msg.type === "session_created" ||
        msg.type === "session_updated" ||
        isRemoteDataRefreshMessage(msg)
      ) {
        scheduleLoad();
      }
      if (msg.type === "new_event") {
        const newEvent = msg.data as DashboardEvent;
        if (newEvent.tool_name === "update_plan") {
          scheduleLoad();
        }
        setRecentEvents((prev) => {
          // Deduplicate by event ID to prevent WS + polling race condition
          if (newEvent.id && prev.some((e) => e.id === newEvent.id)) return prev;
          return [newEvent, ...prev.slice(0, 14)];
        });
      }
    });
    return () => {
      unsubscribe();
      // Drop any pending trailing reload: after cleanup its closure is stale
      // (old filters/scope) and its response could overwrite newer state.
      if (throttleRef.timer) clearTimeout(throttleRef.timer);
    };
  }, [load]);

  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);

  // Memoize agent tree structure to avoid recalculating on every render
  const agentTree = useMemo(() => {
    const childrenByParent = new Map<string, Agent[]>();
    for (const a of allSubagents) {
      if (a.parent_agent_id) {
        const list = childrenByParent.get(a.parent_agent_id) || [];
        list.push(a);
        childrenByParent.set(a.parent_agent_id, list);
      }
    }
    return { childrenByParent };
  }, [allSubagents]);

  const toggleAgentExpanded = useCallback((id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 mb-2">{t("failedConnect")}</p>
        <p className="text-sm text-gray-500">{error}</p>
        <button onClick={load} className="btn-primary mt-4">
          {t("common:retry")}
        </button>
      </div>
    );
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as DashboardTab)}
      className="flex flex-col gap-8 animate-fade-in min-h-[calc(100vh-4rem)]"
    >
      <PageHeader
        icon={LayoutDashboard}
        title={t("title")}
        subtitle={t("subtitle")}
        live={wsConnected}
        actions={
          <>
            <TabsList>
              <TabsTrigger value="monitor" icon={Activity}>
                {t("tabs.monitor")}
              </TabsTrigger>
              <TabsTrigger value="health" icon={Server}>
                {t("tabs.health")}
              </TabsTrigger>
            </TabsList>
            <Button variant="ghost" icon={RefreshCw} onClick={load} className="flex-shrink-0">
              {t("common:refresh")}
            </Button>
          </>
        }
      />

      <TabsContent value="monitor" className="flex-1 flex flex-col gap-8 min-h-0">
        {/* Stats grid - 2 rows of 3 avoids the 6-column squeeze */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            label={t("totalSessions")}
            value={stats ? fmt(stats.total_sessions) : ""}
            raw={stats ? stats.total_sessions.toLocaleString() : undefined}
            icon={FolderOpen}
            trend={stats ? `${stats.active_sessions}${t("activeTrend")}` : undefined}
            loading={!stats}
          />
          <StatCard
            label={t("activeAgents")}
            value={stats?.active_agents ?? ""}
            icon={Bot}
            accentColor="text-emerald-400"
            loading={!stats}
          />
          <StatCard
            label={t("activeSubagents")}
            value={stats ? allSubagents.filter((a) => a.status === "working").length : ""}
            icon={GitBranch}
            accentColor="text-violet-400"
            trend={stats ? `${allSubagents.length}${t("totalTrend")}` : undefined}
            loading={!stats}
          />
          <StatCard
            label={t("eventsToday")}
            value={stats ? fmt(stats.events_today) : ""}
            raw={stats ? stats.events_today.toLocaleString() : undefined}
            icon={Zap}
            accentColor="text-yellow-400"
            loading={!stats}
          />
          <StatCard
            label={t("totalEvents")}
            value={stats ? fmt(stats.total_events) : ""}
            raw={stats ? stats.total_events.toLocaleString() : undefined}
            icon={Activity}
            accentColor="text-violet-400"
            loading={!stats}
          />
          <StatCard
            label={t("totalCost")}
            value={totalCost !== null ? fmtCost(totalCost) : ""}
            raw={
              totalCost !== null
                ? `$${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : undefined
            }
            icon={DollarSign}
            accentColor="text-emerald-400"
            loading={totalCost === null}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-0 min-w-0 flex-1 min-h-0">
          {/* Active agents */}
          <div ref={agentsContainerRef} className="min-w-0 overflow-y-auto pr-6">
            <div className="mb-4">
              <SectionHeader
                size="sm"
                title={t("activeAgentsSection")}
                actions={
                  <Button variant="ghost" size="xs" to={routes.kanban()}>
                    {t("viewBoard")} <ArrowRight className="w-3 h-3" />
                  </Button>
                }
              />
            </div>
            {activeAgents.length === 0 ? (
              <EmptyState icon={Bot} title={t("noAgents")} description={t("noAgentsDesc")} />
            ) : (
              <div className="space-y-2">
                {(() => {
                  const { childrenByParent } = agentTree;

                  // Build the set of agent ids that will be rendered as
                  // descendants under the visible main-agent trees, so the
                  // orphan-subagent block below doesn't render them a
                  // second time at the root. Previously the orphan filter
                  // was `a.type === "subagent"` with no parentage check,
                  // which surfaced every nested subagent twice: once
                  // indented under its main, and once flush at root level.
                  const visibleMains = activeAgents
                    .filter((a) => a.type === "main")
                    .slice(0, visibleAgentCount);
                  const renderedInTree = new Set<string>();
                  for (const m of visibleMains) {
                    const stack: string[] = [m.id];
                    while (stack.length) {
                      const id = stack.pop()!;
                      if (renderedInTree.has(id)) continue;
                      renderedInTree.add(id);
                      for (const child of childrenByParent.get(id) || []) {
                        stack.push(child.id);
                      }
                    }
                  }

                  return (
                    <>
                      <AgentTree
                        roots={visibleMains}
                        childrenByParent={childrenByParent}
                        expanded={expandedAgents}
                        onToggle={toggleAgentExpanded}
                        // Row click always navigates (AgentCard's default →
                        // session details), whether or not it has children.
                        // Expand/collapse is handled solely by the chevron
                        // button, so clicking a parent (incl. the main agent)
                        // no longer toggles.
                        renderCard={(agent) => (
                          <AgentCard
                            variant="row"
                            agent={agent}
                            session={sessionsById.get(agent.session_id)}
                            onClick={undefined}
                          />
                        )}
                        collapsedLabel={(_agent, descendants) => {
                          const activeDesc = descendants.filter(
                            (d) => d.status === "working"
                          ).length;
                          return (
                            <>
                              {t("common:subagent_label", { count: descendants.length })}
                              {activeDesc > 0 && (
                                <span className="text-emerald-400 ml-1">
                                  ({activeDesc} {t("common:active")})
                                </span>
                              )}
                            </>
                          );
                        }}
                        // Reserve the chevron column on top-level mains that
                        // have no chevron - without this, peer mains would line
                        // up at different x positions depending on whether
                        // they have subagents, making chevron-having mains look
                        // indented like a subagent of the chevron-less main
                        // above them. A muted leaf-marker icon fills the slot
                        // so the column reads as deliberately empty rather
                        // than as a misalignment.
                        leafSlot={(_agent, depth) =>
                          depth === 0 ? (
                            <span
                              className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-violet-400/70"
                              aria-hidden="true"
                              title={t("noSubagents")}
                            >
                              <CircleDot className="w-4 h-4" strokeWidth={2} />
                            </span>
                          ) : null
                        }
                      />
                      {/* Only true orphans: subagents whose ancestor chain
                            isn't already shown in a tree above. */}
                      {activeAgents
                        .filter((a) => a.type === "subagent" && !renderedInTree.has(a.id))
                        .map((agent) => (
                          <div key={agent.id}>
                            <AgentCard
                              variant="row"
                              agent={agent}
                              session={sessionsById.get(agent.session_id)}
                            />
                          </div>
                        ))}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Vertical Divider */}
          <div className="hidden lg:block w-px bg-border self-stretch" />

          {/* Recent activity */}
          <div ref={activityContainerRef} className="min-w-0 overflow-y-auto pl-6">
            <div className="mb-4">
              <SectionHeader
                size="sm"
                title={t("recentActivity")}
                actions={
                  <Button variant="ghost" size="xs" to={routes.activity()}>
                    {t("viewAll")} <ArrowRight className="w-3 h-3" />
                  </Button>
                }
              />
            </div>
            {recentEvents.length === 0 ? (
              <EmptyState
                icon={Activity}
                title={t("noActivity")}
                description={t("noActivityDesc")}
              />
            ) : (
              <div className="card divide-y divide-border">
                {recentEvents.slice(0, visibleActivityCount).map((event, i) => {
                  // Session label: real name when one exists, else the
                  // short ID - keeps every activity row attributable.
                  const s = sessionsById.get(event.session_id);
                  const sname = s?.name?.trim() || "";
                  const named = Boolean(sname) && !/^Session [0-9a-f]{8}$/i.test(sname);
                  return (
                    <Clickable
                      key={event.id ?? i}
                      to={routes.session(event.session_id, { event: event.id })}
                      menu={
                        event.id != null
                          ? entityMenu(
                              {
                                kind: "event",
                                id: event.id,
                                sessionId: event.session_id,
                                toolName: event.tool_name,
                                agentId: event.agent_id,
                              },
                              { t, copy: copyText }
                            )
                          : undefined
                      }
                      menuLabel={t("common:ui.openMenuFor", {
                        name: named ? sname : event.session_id.slice(0, 8),
                      })}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-surface-4 transition-colors"
                    >
                      {/* Shared with ActivityFeed/SessionDetail so one event
                            never shows two different badges (issue #310). */}
                      <AgentStatusBadge status={activityStatusFromEvent(event)} pulse={false} />
                      <span className="text-sm text-gray-300 truncate flex-1">
                        {event.summary || event.event_type}
                      </span>
                      <EntityRef
                        kind="session"
                        id={event.session_id}
                        name={named ? sname : null}
                        cwd={s?.cwd}
                        source={s?.source}
                        mono={!named}
                        tabbable={false}
                        className="text-[11px] text-gray-500 max-w-[9rem] flex-shrink-0"
                      >
                        {named ? sname : event.session_id.slice(0, 8)}
                      </EntityRef>
                      {event.tool_name && (
                        <EntityRef
                          kind="tool"
                          name={event.tool_name}
                          sessionId={event.session_id}
                          tabbable={false}
                          className="text-gray-500"
                        />
                      )}
                      <span className="text-[11px] text-gray-600 flex-shrink-0">
                        {timeAgo(event.created_at)}
                      </span>
                    </Clickable>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </TabsContent>
      <TabsContent value="health">
        <SystemHealthTab />
      </TabsContent>
    </Tabs>
  );
}
