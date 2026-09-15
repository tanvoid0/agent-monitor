/**
 * @file types.ts
 * @description TypeScript shapes for the plan layer's join model (`GET
 * /api/plans/:slug/model`, WS `plan_model`), per docs/plan-layer.md §4.4. The
 * fixture at test/fixtures/plan/ledgerflow/expected/model.json is v2's shape —
 * a subset that never carries `project`, `cost`, `say`, `waiting`, `claudeId`
 * on any agent, and `window` only on agents with a resolved model. Those
 * fields are typed optional so the page renders gracefully whether the data
 * came from the v2-shaped fixture or the fuller v3 join once Lane S lands.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

export type PlanTaskStatus = "todo" | "doing" | "reported" | "blocked" | "done";

export interface PlanMilestoneStep {
  num: string;
  title: string;
  done: boolean;
  current: boolean;
  commit: string | null;
}

export interface PlanMilestone {
  id: string;
  title: string;
  done: boolean;
  steps: PlanMilestoneStep[];
}

export interface PlanLogLine {
  ts: string;
  agent: string;
  key?: string;
  status: "start" | "done" | "blocked" | "note";
  note?: string | null;
}

export interface PlanCounts {
  done: number;
  reported: number;
  doing: number;
  blocked: number;
  todo: number;
  total: number;
}

export interface PlanTask {
  key: string;
  text: string;
  depth: number;
  ticked: boolean;
  status: PlanTaskStatus;
  agent: string | null;
  agentId: string | null;
  started: string | null;
  finished: string | null;
  ms: number | null;
  tools: number;
  errors: number;
  note?: string | null;
  log: PlanLogLine[];
  children: PlanTask[];
}

export interface PlanLane {
  letter: string;
  name: string;
  tags: string[];
  mode: "serial" | "parallel" | "inline" | "optional";
  touches: string;
  tasks: PlanTask[];
  agents: string[];
  live: string | null;
  counts: PlanCounts;
}

export interface PlanStory {
  id: string;
  kind: "step" | "sandbox";
  num: number;
  title: string;
  doneWhen: string;
  decisions: string;
  counts: PlanCounts;
  lanes: PlanLane[];
}

/** Present once `agents.status = 'waiting'` (§4.1) is joined — absent in the
 *  v2-shaped fixture. */
export interface PlanWaiting {
  kind: string;
  tool: string;
  since: string;
}

export interface PlanAgent {
  id: string;
  /** `claude_agent_id` from the §4.1 bind — v3 only. */
  claudeId?: string | null;
  type: string;
  session: string;
  lane: string | null;
  story: string | null;
  title: string;
  start: string;
  stop: string | null;
  live: boolean;
  waiting?: PlanWaiting | null;
  /** Last assistant text block, ≤ 300 chars — v3 only. */
  say?: string | null;
  lastTs: string;
  lastTool: string | null;
  last: string;
  tools: number;
  errors: number;
  box: string | null;
  model: string | null;
  calls?: number;
  out: number;
  ctx: number;
  ctxPct: number;
  /** Context window size (200k/1M) — omitted when no model has resolved yet. */
  window?: number;
  /** `tokensByModel` × `model_pricing` — v3 only. */
  cost?: number;
}

export interface PlanTotals {
  agents: number;
  live: number;
  waiting?: number;
  tools: number;
  errors: number;
  cost?: number;
  out?: number;
  sessions: string[];
}

export interface PlanModel {
  now: string;
  /** v3 only — the fixture (v2 shape) has no top-level project block. */
  project?: { slug: string; cwd: string; step: number | null };
  status: { date: string; text: string };
  steps: { done: number; total: number; current: number | null };
  milestones: PlanMilestone[];
  stories: PlanStory[];
  agents: Record<string, PlanAgent>;
  totals: PlanTotals;
}

/** One row of `GET /api/plans` (§4.5) — the project picker's source list. */
export interface PlanListItem {
  slug: string;
  cwd: string;
  step: number | null;
  counts?: PlanCounts;
  live?: number;
  waiting?: number;
  lastEventAge?: string;
}

/** Board columns in render order. `blocked` tasks bucket into `doing` (the
 *  board has 4 columns for 5 statuses per §4.6); the card itself carries a
 *  distinct blocked marker so the state isn't lost, just not given its own
 *  column. */
export const BOARD_COLUMNS: { status: "todo" | "doing" | "reported" | "done" }[] = [
  { status: "todo" },
  { status: "doing" },
  { status: "reported" },
  { status: "done" },
];

export function boardColumnFor(status: PlanTaskStatus): "todo" | "doing" | "reported" | "done" {
  return status === "blocked" ? "doing" : status;
}

/** Badge color per task status, matching the `badge`/`STATUS_CONFIG` palette
 *  convention in `lib/types.ts` (green=live/good, amber=attention, violet=
 *  done, gray=idle) so plan cards read consistently with the rest of CCAM. */
export const TASK_STATUS_STYLE: Record<PlanTaskStatus, { color: string; bg: string; dot: string }> =
  {
    todo: { color: "text-gray-400", bg: "bg-gray-500/10 border-gray-500/20", dot: "bg-gray-400" },
    doing: {
      color: "text-emerald-400",
      bg: "bg-emerald-500/10 border-emerald-500/20",
      dot: "bg-emerald-400",
    },
    blocked: {
      color: "text-red-400",
      bg: "bg-red-500/10 border-red-500/20",
      dot: "bg-red-400",
    },
    reported: {
      color: "text-yellow-400",
      bg: "bg-yellow-500/10 border-yellow-500/20",
      dot: "bg-yellow-400",
    },
    done: {
      color: "text-violet-400",
      bg: "bg-violet-500/10 border-violet-500/20",
      dot: "bg-violet-400",
    },
  };
