/**
 * @file Workflows.tsx
 * @description Displays comprehensive analytics on agent orchestration patterns, including DAGs of agent spawning, tool usage flows, collaboration networks, and session complexity metrics, with real-time updates and interactive filtering. Deep links: `?session=<id>` opens (and scrolls to) the session drill-in, `?run=<id>` expands that Workflow-tool run; both are written back with replace semantics.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/Claude-Code-Agent-Monitor/client/src/pages/Workflows.tsx`
 * **Purpose:** Workflow analytics visualization built on D3; consumes aggregated session/run metrics from the workflows API.
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
 * - `../lib/types`
 * - `../components/workflows/WorkflowStats`
 * - `../components/workflows/OrchestrationDAG`
 * - `../components/workflows/ToolExecutionFlow`
 * - `../components/workflows/AgentCollaborationNetwork`
 * - `../components/workflows/SubagentEffectiveness`
 * - `../components/workflows/WorkflowPatterns`
 * - `../components/workflows/ModelDelegationFlow`
 * - `../components/workflows/ErrorPropagationMap`
 * - `../components/workflows/ConcurrencyTimeline`
 *
 * ## Public surface
 * - `Workflows` — exported API; see TSDoc on the symbol for behavior.
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
 * **Workflows**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Workflow, RefreshCw, Download, AlertCircle, Info } from "lucide-react";
import { api } from "../lib/api";
import { usePaletteAction } from "../components/PaletteActionProvider";
import { Button, IconButton, PageHeader, SegmentedControl } from "../components/ui";

import { useDataScope } from "../lib/dataScope";
import { getCurrentLocale } from "../lib/format";
import { eventBus } from "../lib/eventBus";
import type { WorkflowData, WSMessage } from "../lib/types";

import { WorkflowStats } from "../components/workflows/WorkflowStats";
import { OrchestrationDAG } from "../components/workflows/OrchestrationDAG";
import { ToolExecutionFlow } from "../components/workflows/ToolExecutionFlow";
import { AgentCollaborationNetwork } from "../components/workflows/AgentCollaborationNetwork";
import { SubagentEffectiveness } from "../components/workflows/SubagentEffectiveness";
import { WorkflowPatterns } from "../components/workflows/WorkflowPatterns";
import { ModelDelegationFlow } from "../components/workflows/ModelDelegationFlow";
import { ErrorPropagationMap } from "../components/workflows/ErrorPropagationMap";
import { ConcurrencyTimeline } from "../components/workflows/ConcurrencyTimeline";
import { SessionComplexityScatter } from "../components/workflows/SessionComplexityScatter";
import { CompactionImpact } from "../components/workflows/CompactionImpact";
import { SessionDrillIn } from "../components/workflows/SessionDrillIn";
import { WorkflowRunsPanel } from "../components/workflows/WorkflowRunsPanel";

type StatusFilter = "all" | "active" | "completed";

const DRILL_IN_ID = "workflows-drill-in";

export function Workflows() {
  const { t } = useTranslation("workflows");
  const [dataScope] = useDataScope();
  const isCodexOnly = dataScope.provider === "codex";
  const [data, setData] = useState<WorkflowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // `?session=` (drill-in) and `?run=` (expanded Workflow-tool run) live in
  // the URL so they can be deep-linked; in-page changes replace history.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSessionId = searchParams.get("session");
  const expandedRunId = searchParams.get("run");
  const setParam = useCallback(
    (key: "session" | "run", value: string | null) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true }
      ),
    [setSearchParams]
  );
  const setSelectedSessionId = useCallback(
    (id: string | null) => setParam("session", id),
    [setParam]
  );

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const result = await api.workflows.get(statusFilter);
      setData(result);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dataScope]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  usePaletteAction("page.refresh", () => {
    void fetchData();
  });

  // Bring the drill-in into view when a session is (deep-)linked; the section
  // only exists once the page data has loaded.
  const hasData = data !== null;
  useEffect(() => {
    if (!selectedSessionId || !hasData) return;
    document.getElementById(DRILL_IN_ID)?.scrollIntoView({ block: "start" });
  }, [selectedSessionId, hasData]);

  // Auto-refresh on WebSocket events
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>;
    const handler = (_msg: WSMessage) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchData, 3000);
    };
    const unsub = eventBus.subscribe(handler);
    return () => {
      unsub();
      clearTimeout(debounceTimer);
    };
  }, [fetchData]);

  const handleRefresh = () => {
    setLoading(true);
    fetchData();
  };

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflows-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Header
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onRefresh={handleRefresh}
          onExport={handleExport}
          lastUpdated={null}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse bg-surface-2" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-64 animate-pulse bg-surface-2" />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <Header
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onRefresh={handleRefresh}
          onExport={handleExport}
          lastUpdated={null}
        />
        <div className="card flex flex-col items-center justify-center py-16 gap-4">
          <AlertCircle className="w-10 h-10 text-red-400" />
          <p className="text-red-400 text-sm">{error}</p>
          <Button variant="primary" size="sm" onClick={handleRefresh}>
            {t("common:retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <Header
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onRefresh={handleRefresh}
        onExport={handleExport}
        lastUpdated={lastUpdated}
      />

      {/* Stats Row */}
      <WorkflowStats stats={data.stats} />

      {/* Workflow-tool runs are Claude-only on-disk journals. Codex has no
          matching feature, so hide this rather than showing an empty card. */}
      {!isCodexOnly && (
        <div className="card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Workflow className="w-4 h-4 text-violet-400" />
              {t("runs.title")}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{t("runs.subtitle")}</p>
          </div>
          <WorkflowRunsPanel
            statusFilter={statusFilter}
            expandedRunId={expandedRunId}
            onExpandedRunChange={(id) => setParam("run", id)}
          />
        </div>
      )}

      {/* Section 1: Agent Orchestration DAG */}
      <Section
        number={1}
        title={t("orchestration.title")}
        subtitle={t("orchestration.subtitle")}
        infoKey="orchestration"
      >
        <OrchestrationDAG
          data={data.orchestration}
          onNodeClick={setSelectedNode}
          selectedNode={selectedNode}
        />
        {selectedNode && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-gray-500">{t("filteredBy")}</span>
            <span className="badge bg-accent/15 text-accent border border-accent/20 text-xs">
              {selectedNode}
            </span>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-xs text-gray-500 hover:text-gray-300 underline"
            >
              {t("clearFilter")}
            </button>
          </div>
        )}
      </Section>

      {/* Section 2: Tool Execution Flow */}
      <Section
        number={2}
        title={t("toolFlow.title")}
        subtitle={t("toolFlow.subtitle")}
        infoKey="toolFlow"
      >
        <ToolExecutionFlow data={data.toolFlow} filterAgentType={selectedNode} />
      </Section>

      {/* Section 3: Agent Collaboration Network */}
      <Section
        number={3}
        title={t("pipeline.title")}
        subtitle={t("pipeline.subtitle")}
        infoKey="pipeline"
      >
        <AgentCollaborationNetwork effectiveness={data.effectiveness} edges={data.cooccurrence} />
      </Section>

      {/* Section 4 + 5: Two Column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          number={4}
          title={t("effectiveness.title")}
          subtitle={t("effectiveness.subtitle")}
          infoKey="effectiveness"
        >
          <SubagentEffectiveness data={data.effectiveness} />
        </Section>

        <Section
          number={5}
          title={t("patterns.title")}
          subtitle={t("patterns.subtitle")}
          infoKey="patterns"
        >
          <WorkflowPatterns data={data.patterns} onPatternClick={() => {}} />
        </Section>
      </div>

      {/* Section 6 + 7: Two Column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          number={6}
          title={t("modelDelegation.title")}
          subtitle={t("modelDelegation.subtitle")}
          infoKey="modelDelegation"
        >
          <ModelDelegationFlow data={data.modelDelegation} />
        </Section>

        <Section
          number={7}
          title={t("errorPropagation.title")}
          subtitle={t("errorPropagation.subtitle")}
          infoKey="errorPropagation"
        >
          <ErrorPropagationMap data={data.errorPropagation} />
        </Section>
      </div>

      {/* Section 8: Agent Concurrency Timeline */}
      <Section
        number={8}
        title={t("concurrency.title")}
        subtitle={t("concurrency.subtitle")}
        infoKey="concurrency"
      >
        <ConcurrencyTimeline data={data.concurrency} />
      </Section>

      {/* Section 9 + 10: Two Column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          number={9}
          title={t("complexity.title")}
          subtitle={t("complexity.subtitle")}
          infoKey="complexity"
        >
          <SessionComplexityScatter data={data.complexity} onSessionClick={setSelectedSessionId} />
        </Section>

        <Section
          number={10}
          title={t("compaction.title")}
          subtitle={t("compaction.subtitle")}
          infoKey="compaction"
        >
          <CompactionImpact data={data.compaction} />
        </Section>
      </div>

      {/* Section 11: Session Drill-In */}
      <Section
        id={DRILL_IN_ID}
        number={11}
        title={t("drillIn.title")}
        subtitle={t("drillIn.subtitle")}
        infoKey="drillIn"
      >
        <SessionDrillIn
          sessionId={selectedSessionId}
          onClose={() => setSelectedSessionId(null)}
          onSelectSession={(id) => setSelectedSessionId(id)}
        />
      </Section>
    </div>
  );
}

// ── Section wrapper ──
function Section({
  id,
  number,
  title,
  subtitle,
  infoKey,
  children,
}: {
  /** DOM id, for scroll targets (`?session=` deep link). */
  id?: string;
  number: number;
  title: string;
  subtitle: string;
  /** Key under workflows.chartInfo.* - drives the structured popover content. */
  infoKey: string;
  children: React.ReactNode;
}) {
  return (
    // Flex column + a flex-1 card so that, when two Sections share a grid row
    // (lg:grid-cols-2), the grid's default row-stretch reaches the card itself —
    // otherwise a shorter chart (e.g. the Session Complexity Scatter) leaves its
    // card shorter than a taller companion (Compaction Impact) in the same row.
    <div id={id} className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-5 h-5 rounded-md bg-accent/15 text-accent text-[11px] font-bold flex items-center justify-center flex-shrink-0">
            {number}
          </span>
          <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
          <ChartInfoPopover infoKey={infoKey} title={title} />
        </div>
        {/* Quick descriptor; the full explanation lives in the ⓘ popover, so we
            keep this to a single clamped line (ellipsis + hover title) so a long
            translation never wraps and unbalances the header row. */}
        <span
          className="hidden lg:block flex-shrink-0 max-w-[20rem] xl:max-w-sm truncate text-right text-[11px] text-gray-600"
          title={subtitle}
        >
          {subtitle}
        </span>
      </div>
      <div className="card p-4 flex-1">{children}</div>
    </div>
  );
}

/**
 * Structured info popover for a Workflows chart section. Hover or focus the
 * `i` icon to read three short paragraphs sourced from i18n:
 *
 *   1. What this shows  - what data the chart visualizes
 *   2. How to read it   - visual encoding (axes, sizes, colors, etc.)
 *   3. Why it matters   - what insights the user can extract
 *
 * The popover uses fixed positioning and is clamped to the viewport so it
 * never gets clipped by the sidebar or screen edges. Auto-flips above the
 * trigger when there's no room below.
 */
function ChartInfoPopover({ infoKey, title }: { infoKey: string; title: string }) {
  const { t } = useTranslation("workflows");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  const POPOVER_W = 340;
  const MARGIN = 12;

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const btn = buttonRef.current;
      const pop = popoverRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const popH = pop?.offsetHeight ?? 280;

      // Center horizontally over the icon, clamp to viewport.
      let left = r.left + r.width / 2 - POPOVER_W / 2;
      if (left < MARGIN) left = MARGIN;
      if (left + POPOVER_W > window.innerWidth - MARGIN) {
        left = window.innerWidth - POPOVER_W - MARGIN;
      }
      // Default below the icon; flip above if not enough room.
      const spaceBelow = window.innerHeight - r.bottom;
      const placeAbove = spaceBelow < popH + MARGIN && r.top > popH + MARGIN;
      const top = placeAbove ? Math.max(MARGIN, r.top - popH - 8) : r.bottom + 8;

      setCoords({ left, top });
    };
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("chartInfo.labels.what")}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex items-center justify-center rounded-full p-0.5 -m-0.5 text-gray-600 hover:text-gray-400 transition-colors focus:outline-none focus:ring-1 focus:ring-accent/40"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="tooltip"
          className="fixed z-50 p-3.5 bg-[#12121f] border border-[#2a2a4a] rounded-lg shadow-2xl text-[11px] text-gray-300 pointer-events-none"
          style={{ left: coords.left, top: coords.top, width: POPOVER_W }}
        >
          <p className="text-xs font-semibold text-gray-100 mb-2.5 pb-2 border-b border-[#2a2a4a]">
            {title}
          </p>

          <p className="font-semibold text-gray-200 uppercase tracking-wider text-[9px] mb-1">
            {t("chartInfo.labels.what")}
          </p>
          <p className="text-gray-400 leading-snug mb-2.5">{t(`chartInfo.${infoKey}.what`)}</p>

          <p className="font-semibold text-gray-200 uppercase tracking-wider text-[9px] mb-1">
            {t("chartInfo.labels.howToRead")}
          </p>
          <p className="text-gray-400 leading-snug mb-2.5">{t(`chartInfo.${infoKey}.howToRead`)}</p>

          <p className="font-semibold text-gray-200 uppercase tracking-wider text-[9px] mb-1">
            {t("chartInfo.labels.why")}
          </p>
          <p className="text-gray-400 leading-snug">{t(`chartInfo.${infoKey}.why`)}</p>
        </div>
      )}
    </>
  );
}

// ── Page Header ──
function Header({
  statusFilter,
  onStatusFilterChange,
  onRefresh,
  onExport,
  lastUpdated,
}: {
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  onRefresh: () => void;
  onExport: () => void;
  lastUpdated: Date | null;
}) {
  const { t } = useTranslation("workflows");
  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);
  const filters: { value: StatusFilter; label: string }[] = [
    { value: "all", label: t("allSessions") },
    { value: "active", label: t("activeOnly") },
    { value: "completed", label: t("completed") },
  ];

  return (
    <PageHeader
      icon={Workflow}
      title={t("title")}
      subtitle={t("subtitle")}
      live={wsConnected}
      actions={
        <>
          <SegmentedControl
            size="sm"
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            items={filters}
            ariaLabel={t("statusFilter")}
          />
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={onRefresh}>
            {t("common:refresh")}
          </Button>
          <IconButton icon={Download} label={t("exportJson")} size="md" onClick={onExport} />
          {lastUpdated && (
            <span className="text-[10px] text-gray-600 ml-1">
              {t("common:updated")}
              {lastUpdated.toLocaleTimeString(getCurrentLocale())}
            </span>
          )}
        </>
      }
    />
  );
}
