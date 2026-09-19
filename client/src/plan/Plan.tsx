/**
 * @file Plan.tsx
 * @description The plan layer's page (docs/plan-layer.md §4.6), route
 * `/plan/:slug?`: a project picker, a stories rail (milestones → steps →
 * lanes), a board (To do · Doing · Reported · Done columns of boxes), a live
 * agents panel, and a task detail drawer. Reads `GET /api/plans` and
 * `GET /api/plans/:slug/model`, ticks boxes via `POST /api/plans/:slug/tick`
 * (optimistic, reverted on a 4xx), and stays live via the shared WebSocket
 * pipeline (`plan_updated`, `plan_model`, `plan_log`). `?task=<key>` opens the
 * task drawer (written back with replace semantics); agent rows, task-card
 * agent badges and the project cwd are `EntityRef` chips.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  SquareKanban,
  ChevronDown,
  ChevronRight,
  X,
  Menu,
  PanelRight,
  Bot,
  Clock,
  Cpu,
  Coins,
  Wrench,
  MessageSquareQuote,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { planApi } from "./api";
import { eventBus } from "../lib/eventBus";
import { api } from "../lib/api";
import { EmptyState } from "../components/EmptyState";
import { CardSkeleton } from "../components/Skeleton";
import { Select } from "../components/Select";
import { Checkbox } from "../components/Checkbox";
import { Button, IconButton, PageHeader } from "../components/ui";
import { EntityRef } from "../components/entity";
import { routes } from "../lib/routes";
import {
  formatDuration,
  timeAgo,
  formatMs,
  fmtCost,
  formatModelName,
  truncate,
} from "../lib/format";
import {
  BOARD_COLUMNS,
  TASK_STATUS_STYLE,
  boardColumnFor,
  type PlanAgent,
  type PlanLane,
  type PlanListItem,
  type PlanModel,
  type PlanStory,
  type PlanTask,
} from "./types";
import type { DashboardEvent, WSMessage } from "../lib/types";

const LAST_SLUG_KEY = "plan-last-slug";

/** Runtime shape of the WS messages this page cares about — `plan_updated` /
 *  `plan_model` / `plan_log` aren't part of `lib/types.ts`'s `WSMessage`
 *  union (that file is out of Lane P's touches), so the handler narrows via
 *  a local cast instead of extending the shared type. */
interface PlanWSEnvelope {
  type: string;
  data: unknown;
}

function readLastSlug(): string | null {
  try {
    return localStorage.getItem(LAST_SLUG_KEY);
  } catch {
    return null;
  }
}

function rememberSlug(slug: string) {
  try {
    localStorage.setItem(LAST_SLUG_KEY, slug);
  } catch {
    /* best-effort */
  }
}

function resolveAgent(model: PlanModel, agentId: string | null): PlanAgent | undefined {
  return agentId ? model.agents[agentId] : undefined;
}

/** Locate a task (with its story and lane) by key, at any nesting depth. */
function findTask(
  model: PlanModel,
  key: string
): { story: PlanStory; lane: PlanLane; task: PlanTask } | null {
  for (const story of model.stories) {
    for (const lane of story.lanes) {
      const stack = [...lane.tasks];
      while (stack.length > 0) {
        const task = stack.pop()!;
        if (task.key === key) return { story, lane, task };
        stack.push(...task.children);
      }
    }
  }
  return null;
}

function currentStoryId(model: PlanModel): string | null {
  const current = model.stories.find((s) => s.kind === "step" && s.num === model.steps.current);
  return current?.id ?? model.stories[0]?.id ?? null;
}

export function Plan() {
  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation("plan");

  const [plans, setPlans] = useState<PlanListItem[]>([]);
  const [model, setModel] = useState<PlanModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storyId, setStoryId] = useState<string | null>(null);
  const [laneFilter, setLaneFilter] = useState<string | null>(null);
  // The open task drawer lives in `?task=<key>` (deep-linkable; replace).
  const [searchParams, setSearchParams] = useSearchParams();
  const taskKey = searchParams.get("task");
  const setTaskKey = useCallback(
    (key: string | null) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (key) next.set("task", key);
          else next.delete("task");
          return next;
        },
        { replace: true }
      ),
    [setSearchParams]
  );
  const [pendingTicks, setPendingTicks] = useState<Record<string, boolean>>({});
  const [tickError, setTickError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);

  useEffect(() => {
    planApi
      .list()
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  // P2: route param wins; falling back to the last-used slug (localStorage),
  // then the first available plan, lets a bare `/plan` visit land somewhere.
  useEffect(() => {
    if (routeSlug) {
      rememberSlug(routeSlug);
      return;
    }
    const fallback = readLastSlug() ?? plans[0]?.slug;
    if (fallback) navigate(routes.plan(fallback), { replace: true });
  }, [routeSlug, plans, navigate]);

  const loadModel = useCallback(async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const m = await planApi.model(slug);
      setModel(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!routeSlug) return;
    setModel(null);
    setStoryId(null);
    setLaneFilter(null);
    loadModel(routeSlug);
  }, [routeSlug, loadModel]);

  // P3: plan_updated → re-parse happened, re-pull the model; plan_model →
  // the server already computed + broadcast the fresh model, use it as-is;
  // plan_log → re-pull rather than re-deriving join.js's status rules
  // (ticked/log-line precedence, parent/child rollups) a second time here.
  useEffect(() => {
    if (!routeSlug) return;
    return eventBus.subscribe((msg: WSMessage) => {
      const raw = msg as unknown as PlanWSEnvelope;
      const data = raw.data as { slug?: string; model?: PlanModel } | undefined;
      if (data?.slug !== routeSlug) return;
      if (raw.type === "plan_model" && data.model) {
        setModel(data.model);
      } else if (raw.type === "plan_updated" || raw.type === "plan_log") {
        loadModel(routeSlug);
      }
    });
  }, [routeSlug, loadModel]);

  useEffect(() => {
    if (!model) return;
    setStoryId((prev) =>
      prev && model.stories.some((s) => s.id === prev) ? prev : currentStoryId(model)
    );
  }, [model]);

  // P4: optimistic flip; on success the authoritative re-pull replaces it, on
  // a 4xx the `finally` drop of the pending override reverts the checkbox.
  const handleTick = useCallback(
    async (key: string, done: boolean) => {
      if (!routeSlug) return;
      setTickError(null);
      setPendingTicks((prev) => ({ ...prev, [key]: done }));
      try {
        await planApi.tick(routeSlug, key, done);
        await loadModel(routeSlug);
      } catch (e) {
        setTickError(e instanceof Error ? e.message : String(e));
      } finally {
        setPendingTicks((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [routeSlug, loadModel]
  );

  const story = useMemo(
    () => model?.stories.find((s) => s.id === storyId) ?? null,
    [model, storyId]
  );
  const selected = useMemo(
    () => (model && taskKey ? findTask(model, taskKey) : null),
    [model, taskKey]
  );

  const totalsCost = model?.totals.cost;
  const totalsWaiting = model?.totals.waiting;

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <PageHeader
          icon={SquareKanban}
          title={t("title")}
          subtitle={
            model && (
              <>
                {model.status.text}
                {typeof totalsCost === "number" && ` · ${fmtCost(totalsCost)}`}
                {typeof totalsWaiting === "number" &&
                  totalsWaiting > 0 &&
                  ` · ${t("picker.waitingCount", { count: totalsWaiting })}`}
                {model.project?.cwd && (
                  <>
                    {" · "}
                    <EntityRef kind="project" cwd={model.project.cwd} mono={false} />
                  </>
                )}
              </>
            )
          }
          actions={
            <>
              {plans.length > 0 && (
                <div className="w-56">
                  <Select
                    value={routeSlug ?? plans[0]!.slug}
                    onChange={(slug) => navigate(routes.plan(slug))}
                    options={plans.map((p) => ({
                      value: p.slug,
                      label: p.slug,
                      hint: [
                        p.cwd,
                        typeof p.live === "number" && p.live > 0
                          ? t("picker.liveCount", { count: p.live })
                          : null,
                        typeof p.waiting === "number" && p.waiting > 0
                          ? t("picker.waitingCount", { count: p.waiting })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    }))}
                  />
                </div>
              )}
              <IconButton
                icon={Menu}
                label={t("toggleRail")}
                size="md"
                className="lg:hidden"
                onClick={() => setRailOpen(true)}
              />
              <IconButton
                icon={PanelRight}
                label={t("toggleAgents")}
                size="md"
                className="lg:hidden"
                onClick={() => setAgentsOpen(true)}
              />
              {routeSlug && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RefreshCw}
                  onClick={() => loadModel(routeSlug)}
                >
                  {t("common:refresh")}
                </Button>
              )}
            </>
          }
        />
      </div>

      {tickError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {t("tick.error", { message: tickError })}
        </div>
      )}

      {loading && !model && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && error && !model && (
        <EmptyState
          icon={SquareKanban}
          title={t("error", { message: error })}
          description=""
          action={
            routeSlug && (
              <Button variant="primary" icon={RefreshCw} onClick={() => loadModel(routeSlug)}>
                {t("common:retry")}
              </Button>
            )
          }
        />
      )}

      {!loading && !error && !model && plans.length === 0 && (
        <EmptyState
          icon={SquareKanban}
          title={t("picker.empty")}
          description={t("picker.emptyDesc")}
        />
      )}

      {model && story && (
        <div className="flex gap-4 min-h-[600px]">
          <aside className="hidden lg:block w-64 flex-shrink-0">
            <RailPanel
              model={model}
              story={story}
              onSelectStory={setStoryId}
              laneFilter={laneFilter}
              onSelectLane={setLaneFilter}
            />
          </aside>

          <div className="flex-1 min-w-0">
            <BoardPanel
              story={story}
              model={model}
              laneFilter={laneFilter}
              pendingTicks={pendingTicks}
              onTick={handleTick}
              onSelectTask={(_lane, task) => setTaskKey(task.key)}
            />
          </div>

          <aside className="hidden lg:block w-72 flex-shrink-0">
            <AgentsPanel model={model} />
          </aside>
        </div>
      )}

      {railOpen && (
        <MobileDrawer side="left" title={t("rail.title")} onClose={() => setRailOpen(false)}>
          {model && story && (
            <RailPanel
              model={model}
              story={story}
              onSelectStory={setStoryId}
              laneFilter={laneFilter}
              onSelectLane={setLaneFilter}
            />
          )}
        </MobileDrawer>
      )}
      {agentsOpen && (
        <MobileDrawer side="right" title={t("agents.title")} onClose={() => setAgentsOpen(false)}>
          {model && <AgentsPanel model={model} />}
        </MobileDrawer>
      )}

      {selected && routeSlug && (
        <DetailDrawer
          story={selected.story}
          lane={selected.lane}
          task={selected.task}
          agent={resolveAgent(model!, selected.task.agentId)}
          onClose={() => setTaskKey(null)}
          onTick={handleTick}
          pendingTicks={pendingTicks}
        />
      )}
    </div>
  );
}

// ───────────────────────────── Mobile drawer shell ─────────────────────────

function MobileDrawer({
  side,
  title,
  onClose,
  children,
}: {
  side: "left" | "right";
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`absolute top-0 bottom-0 w-72 max-w-[85vw] bg-surface-1 border-border p-3 overflow-y-auto ${
          side === "left" ? "left-0 border-r" : "right-0 border-l"
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-gray-400 hover:text-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────────────────────────── Stories rail ─────────────────────────────

function RailPanel({
  model,
  story,
  onSelectStory,
  laneFilter,
  onSelectLane,
}: {
  model: PlanModel;
  story: PlanStory;
  onSelectStory: (id: string) => void;
  laneFilter: string | null;
  onSelectLane: (letter: string | null) => void;
}) {
  const { t } = useTranslation("plan");
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const current = model.milestones.find((m) => m.steps.some((s) => s.current));
    return new Set(current ? [current.id] : []);
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {model.stories.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {model.stories.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelectStory(s.id)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium border ${
                s.id === story.id
                  ? "bg-accent/15 text-accent border-accent/30"
                  : "border-border text-gray-400 hover:text-gray-200"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          {t("rail.stepProgress", { done: model.steps.done, total: model.steps.total })}
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2 mt-3">
          {t("rail.milestones")}
        </p>
        <div className="space-y-1">
          {model.milestones.map((m) => {
            const isOpen = expanded.has(m.id);
            const done = m.steps.filter((s) => s.done).length;
            return (
              <div key={m.id} className="rounded-lg border border-border bg-surface-2">
                <button
                  onClick={() => toggle(m.id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="w-3 h-3 text-gray-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
                  )}
                  <span
                    className={`text-xs font-medium truncate flex-1 ${
                      m.done ? "text-violet-400" : "text-gray-200"
                    }`}
                  >
                    {m.id} — {m.title}
                  </span>
                  <span className="text-[10px] text-gray-500 flex-shrink-0">
                    {done}/{m.steps.length}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-2 pb-2 space-y-0.5">
                    {m.steps.map((s) => (
                      <div
                        key={s.num}
                        className={`flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded ${
                          s.current ? "bg-accent/10 text-accent" : "text-gray-400"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            s.done ? "bg-violet-400" : s.current ? "bg-accent" : "bg-gray-600"
                          }`}
                        />
                        <span className="truncate flex-1">
                          {s.num} {s.title}
                        </span>
                        {s.commit && <span className="font-mono text-gray-600">{s.commit}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {t("rail.lanes")}
          </p>
          {laneFilter && (
            <button
              onClick={() => onSelectLane(null)}
              className="text-[10px] text-accent hover:underline"
            >
              {t("rail.clearLaneFilter")}
            </button>
          )}
        </div>
        <div className="space-y-1">
          {story.lanes.map((lane) => {
            const liveAgent = lane.live ? model.agents[lane.live] : undefined;
            return (
              <button
                key={lane.letter}
                onClick={() => onSelectLane(laneFilter === lane.letter ? null : lane.letter)}
                className={`w-full text-left rounded-lg border px-2 py-1.5 transition-colors ${
                  laneFilter === lane.letter
                    ? "border-accent/40 bg-accent/10"
                    : "border-border bg-surface-2 hover:bg-surface-3"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded bg-surface-4 text-[10px] font-mono flex items-center justify-center flex-shrink-0">
                    {lane.letter}
                  </span>
                  <span className="text-xs text-gray-200 truncate flex-1">{lane.name}</span>
                  <span className="text-[10px] text-gray-500 flex-shrink-0">
                    {lane.counts.done}/{lane.counts.total}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1 pl-5">
                  <span className="badge bg-surface-3 border-border text-gray-500 text-[9px] py-0.5 px-1.5">
                    {lane.mode}
                  </span>
                  {liveAgent && (
                    <span className="text-[10px] text-emerald-400 truncate">
                      {[
                        formatModelName(liveAgent.model),
                        `${liveAgent.ctxPct}%`,
                        fmtCost(liveAgent.cost ?? 0),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Board ─────────────────────────────

function BoardPanel({
  story,
  model,
  laneFilter,
  pendingTicks,
  onTick,
  onSelectTask,
}: {
  story: PlanStory;
  model: PlanModel;
  laneFilter: string | null;
  pendingTicks: Record<string, boolean>;
  onTick: (key: string, done: boolean) => void;
  onSelectTask: (lane: PlanLane, task: PlanTask) => void;
}) {
  const { t } = useTranslation("plan");
  const lanes = laneFilter ? story.lanes.filter((l) => l.letter === laneFilter) : story.lanes;
  const topLevelByColumn = useMemo(() => {
    const byColumn: Record<
      "todo" | "doing" | "reported" | "done",
      { lane: PlanLane; task: PlanTask }[]
    > = {
      todo: [],
      doing: [],
      reported: [],
      done: [],
    };
    for (const lane of lanes) {
      for (const task of lane.tasks) {
        if (task.depth !== 0) continue;
        byColumn[boardColumnFor(task.status)].push({ lane, task });
      }
    }
    return byColumn;
  }, [lanes]);

  const isEmpty = BOARD_COLUMNS.every((c) => topLevelByColumn[c.status].length === 0);
  if (isEmpty) {
    return <div className="card p-6 text-center text-sm text-gray-500">{t("board.empty")}</div>;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {BOARD_COLUMNS.map(({ status }) => (
        <div
          key={status}
          className="bg-surface-1 rounded-xl border border-border p-3 flex flex-col flex-shrink-0 w-72"
        >
          <div className="flex items-center gap-2 mb-3 px-1">
            <span className={`w-2 h-2 rounded-full ${TASK_STATUS_STYLE[status].dot}`} />
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${TASK_STATUS_STYLE[status].color}`}
            >
              {t(`board.columns.${status}`)}
            </span>
            <span className="ml-auto text-[11px] text-gray-600 bg-surface-3 px-2 py-0.5 rounded-full">
              {topLevelByColumn[status].length}
            </span>
          </div>
          <div className="flex-1 space-y-2.5">
            {topLevelByColumn[status].map(({ lane, task }) => (
              <TaskCard
                key={task.key}
                lane={lane}
                task={task}
                model={model}
                pendingTicks={pendingTicks}
                onTick={onTick}
                onSelect={() => onSelectTask(lane, task)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskCard({
  lane,
  task,
  model,
  pendingTicks,
  onTick,
  onSelect,
  depth = 0,
}: {
  lane: PlanLane;
  task: PlanTask;
  model: PlanModel;
  pendingTicks: Record<string, boolean>;
  onTick: (key: string, done: boolean) => void;
  onSelect: () => void;
  depth?: number;
}) {
  const { t } = useTranslation("plan");
  const ticked = task.key in pendingTicks ? pendingTicks[task.key]! : task.ticked;
  const agent = resolveAgent(model, task.agentId);
  const isWaiting = Boolean(agent?.waiting);
  const isBlocked = task.status === "blocked";

  return (
    <div className={depth === 0 ? "card-hover p-3" : "border-l border-border/60 pl-2 py-1"}>
      <div
        className={`flex items-start gap-2 ${isWaiting ? "border-l-2 border-l-amber-500/60 -ml-3 pl-2.5" : isBlocked ? "border-l-2 border-l-red-500/60 -ml-3 pl-2.5" : ""}`}
      >
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={ticked} onChange={(v) => onTick(task.key, v)} className="mt-0.5" />
        </span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onSelect} className="text-left w-full">
            <p
              className={`text-xs leading-snug ${ticked ? "text-gray-500 line-through" : "text-gray-200"}`}
            >
              <span className="font-mono text-gray-500 mr-1">{task.key}</span>
              {truncate(task.text, depth === 0 ? 140 : 90)}
            </p>
          </button>
          {depth === 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="badge bg-surface-3 border-border text-gray-400 text-[9px] py-0.5 px-1.5">
                {lane.letter}
              </span>
              {agent && (
                <span onClick={(e) => e.stopPropagation()}>
                  <EntityRef
                    kind="agent"
                    id={agent.id}
                    sessionId={agent.sessionId}
                    type={agent.type}
                    mono={false}
                    className="badge bg-surface-3 border-border text-gray-400 text-[9px] py-0.5 px-1.5"
                  >
                    {agent.type}
                    {agent.model && ` · ${formatModelName(agent.model)}`}
                    {agent.ctxPct > 0 && ` · ${agent.ctxPct}%`}
                    {typeof agent.cost === "number" &&
                      agent.cost > 0 &&
                      ` · ${fmtCost(agent.cost)}`}
                  </EntityRef>
                </span>
              )}
              {isBlocked && (
                <span className="badge bg-red-500/10 border-red-500/20 text-red-400 text-[9px] py-0.5 px-1.5">
                  {t("status.blocked")}
                </span>
              )}
              {agent?.waiting && (
                <span className="badge bg-amber-500/10 border-amber-500/25 text-amber-300 text-[9px] py-0.5 px-1.5">
                  {t("agents.waiting")} · {agent.waiting.kind} · {agent.waiting.tool}
                </span>
              )}
            </div>
          )}
          {depth === 0 && agent?.live && agent.say && (
            <p className="mt-1.5 text-[10px] text-gray-500 italic truncate">
              "{truncate(agent.say, 80)}"
            </p>
          )}
        </div>
      </div>
      {task.children.length > 0 && (
        <div className="mt-1.5 ml-5 space-y-1">
          {task.children.map((child) => (
            <TaskCard
              key={child.key}
              lane={lane}
              task={child}
              model={model}
              pendingTicks={pendingTicks}
              onTick={onTick}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Agents panel ─────────────────────────────

function AgentsPanel({ model }: { model: PlanModel }) {
  const { t } = useTranslation("plan");
  const agents = useMemo(
    () =>
      Object.values(model.agents)
        .filter((a) => a.lane) // agents dispatched off `Lane X —` prompts, not every pseudo-agent row
        .sort((a, b) => (a.live === b.live ? 0 : a.live ? -1 : 1)),
    [model.agents]
  );

  if (agents.length === 0) {
    return <p className="text-xs text-gray-500">{t("agents.empty")}</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {t("agents.title")}
      </p>
      {agents.map((agent) => (
        <AgentRow key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

function AgentRow({ agent }: { agent: PlanAgent }) {
  const { t } = useTranslation("plan");
  const elapsed = agent.live
    ? timeAgo(agent.start)
    : agent.stop
      ? formatDuration(agent.start, agent.stop)
      : null;
  return (
    <div
      className={`card p-2.5 ${agent.waiting ? "border-l-2 border-l-amber-500/60" : agent.live ? "border-l-2 border-l-emerald-500/50" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <Bot className="w-3 h-3 text-violet-400 flex-shrink-0" />
        <EntityRef
          kind="agent"
          id={agent.id}
          sessionId={agent.sessionId}
          type={agent.type}
          mono={false}
          className="text-xs text-gray-200 flex-1"
        >
          {agent.type}
          {agent.lane && ` · ${agent.lane}`}
        </EntityRef>
        {agent.live && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[10px] text-gray-500">
        {agent.model && (
          <span className="flex items-center gap-1">
            <Cpu className="w-2.5 h-2.5" />
            {formatModelName(agent.model)}
            {agent.ctxPct > 0 && ` ${agent.ctxPct}%`}
          </span>
        )}
        {typeof agent.cost === "number" && agent.cost > 0 && (
          <span className="flex items-center gap-1">
            <Coins className="w-2.5 h-2.5" />
            {fmtCost(agent.cost)}
          </span>
        )}
        {elapsed && (
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {t("agents.elapsed")} {elapsed}
          </span>
        )}
      </div>
      {agent.lastTool && (
        <p className="mt-1 text-[10px] text-gray-600 truncate flex items-center gap-1">
          <Wrench className="w-2.5 h-2.5 flex-shrink-0" />
          {agent.lastTool}: {truncate(agent.last, 50)}
        </p>
      )}
      {agent.waiting && (
        <p className="mt-1 text-[10px] text-amber-300">
          {t("agents.waiting")} · {agent.waiting.kind} · {agent.waiting.tool}
        </p>
      )}
      {agent.live && agent.say && (
        <p className="mt-1 text-[10px] text-gray-500 italic truncate flex items-center gap-1">
          <MessageSquareQuote className="w-2.5 h-2.5 flex-shrink-0" />"{truncate(agent.say, 70)}"
        </p>
      )}
    </div>
  );
}

// ───────────────────────────── Detail drawer ─────────────────────────────

function DetailDrawer({
  story,
  lane,
  task,
  agent,
  onClose,
  onTick,
  pendingTicks,
}: {
  story: PlanStory;
  lane: PlanLane;
  task: PlanTask;
  agent: PlanAgent | undefined;
  onClose: () => void;
  onTick: (key: string, done: boolean) => void;
  pendingTicks: Record<string, boolean>;
}) {
  const { t } = useTranslation("plan");
  const [events, setEvents] = useState<DashboardEvent[]>([]);

  useEffect(() => {
    if (!agent) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    // ponytail: the exact tool-attribution window is join.js's job (§4.4) —
    // this pulls the agent's most recent tool events rather than
    // re-implementing that windowing client-side. Upgrade to a server-side
    // `task`/`agent` text route (§4.5) once Lane S ships it.
    api.events
      .list({ agent_id: [agent.id], event_type: ["PreToolUse"], limit: 10 })
      .then((r) => {
        if (!cancelled) setEvents(r.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [agent]);

  const ticked = task.key in pendingTicks ? pendingTicks[task.key]! : task.ticked;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute top-0 right-0 bottom-0 w-full max-w-md bg-surface-1 border-l border-border p-4 overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500 truncate">
              {story.kind === "step" ? t("detail.stepLabel", { num: story.num }) : story.title}
              {" › "}
              {t("detail.laneLabel", { letter: lane.letter })}
              {" › "}
              {task.key}
            </p>
            <h2 className="text-sm font-semibold text-gray-100 mt-1">{task.text}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common:close")}
            className="p-1 text-gray-400 hover:text-gray-100 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={ticked} onChange={(v) => onTick(task.key, v)} />
          </span>
          <span
            className={`badge ${TASK_STATUS_STYLE[task.status].bg} ${TASK_STATUS_STYLE[task.status].color}`}
          >
            {t(`status.${task.status}`)}
          </span>
        </div>

        {task.note && <p className="text-xs text-gray-400 mb-4">{task.note}</p>}

        {agent && (
          <Link
            to={routes.session(agent.sessionId)}
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline mb-4"
          >
            <ExternalLink className="w-3 h-3" /> {t("detail.openSession")}
          </Link>
        )}

        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            {t("detail.log")}
          </p>
          {task.log.length === 0 ? (
            <p className="text-xs text-gray-500">{t("detail.noLog")}</p>
          ) : (
            <ul className="space-y-1.5">
              {task.log.map((line, i) => (
                <li key={i} className="text-[11px] text-gray-400">
                  <span className="font-mono text-gray-600">{timeAgo(line.ts)}</span>{" "}
                  <span className="text-gray-300">{line.agent}</span>{" "}
                  <span
                    className={
                      TASK_STATUS_STYLE[
                        line.status === "note"
                          ? "doing"
                          : line.status === "start"
                            ? "doing"
                            : line.status
                      ].color
                    }
                  >
                    {line.status}
                  </span>
                  {line.note && <span className="block text-gray-500 mt-0.5">{line.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            {t("detail.toolEvents")}
          </p>
          {events.length === 0 ? (
            <p className="text-xs text-gray-500">{t("detail.noToolEvents")}</p>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="text-[11px] text-gray-400 flex items-start gap-1.5">
                  <Wrench className="w-3 h-3 mt-0.5 flex-shrink-0 text-gray-600" />
                  <span className="min-w-0">
                    <span className="text-gray-300">{e.tool_name}</span>{" "}
                    {e.summary && <span className="text-gray-500">{truncate(e.summary, 90)}</span>}{" "}
                    <span className="text-gray-600">{timeAgo(e.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {task.ms != null && <p className="mt-4 text-[11px] text-gray-500">{formatMs(task.ms)}</p>}
      </div>
    </div>
  );
}
