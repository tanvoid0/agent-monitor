/**
 * @file AgentCard.tsx
 * @description Defines the AgentCard component that displays a summary of an
 * agent's name, status, task, current tool, timestamps, and native Codex
 * title plus a latest-two-human-turn context, with a colour-keyed project badge
 * (open-in-file-manager for local sessions) under the header. Cards reuse
 * session task-progress donuts beside status when available. Two densities:
 * `variant="card"` (default, the full layout) and `variant="row"` (one line
 * for the Dashboard tree and the Kanban rows density). Both are a `Clickable`
 * surface with the agent context menu; the name, current tool, model and
 * session id are `EntityRef` chips. Durable cards navigate to session details
 * while the brief pre-identity Codex process card stays non-navigable.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/agent-monitor/client/src/components/AgentCard.tsx`
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
 * - `./StatusBadge`
 * - `./ui` / `./entity`
 * - `../lib/types`
 * - `../lib/format`
 *
 * ## Public surface
 * - `AgentCard` — exported API; see TSDoc on the symbol for behavior.
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
 * **AgentCard**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useTranslation } from "react-i18next";
import { Bot, GitBranch, Clock, Wrench, Cpu, Coins } from "lucide-react";
import { AgentStatusBadge } from "./StatusBadge";
import { TodoProgressIndicator } from "./TodoProgressIndicator";
import { ProjectBadge } from "./ProjectBadge";
import { CompactRow } from "./CompactRow";
import { Clickable, MenuButton } from "./ui";
import { EntityRef, entityMenu } from "./entity";
import { copyText } from "../lib/clipboard";
import { routes } from "../lib/routes";
import { effectiveAgentStatus, isAgentAwaitingInput, agentAwaitingReason } from "../lib/types";
import type { Agent, Session } from "../lib/types";
import {
  formatDuration,
  timeAgo,
  formatModelName,
  fmtCost,
  promptPreviewLines,
  isTransientProcess,
  pathBasename,
} from "../lib/format";

/**
 * Display name for a main agent, swapping its auto-generated placeholder for the
 * real session title when one exists. Main agents are created as
 * `<prefix> - <placeholder>`, where the placeholder is either `Session <id8>`
 * (live hooks) or `<cwd-folder> - <id8>` (import / background sync). Replacing
 * everything after the first ` - ` covers BOTH formats — the older
 * `replace(/Session [0-9a-f]{8}/)` only matched the hook form, so imported
 * sessions kept showing `<folder> - <id8>` even after their title was known.
 */
function mainAgentDisplayName(agentName: string, realSessionName: string): string {
  if (!realSessionName) return agentName;
  const sep = agentName.indexOf(" - ");
  return sep >= 0 ? `${agentName.slice(0, sep)} - ${realSessionName}` : agentName;
}

interface AgentCardProps {
  agent: Agent;
  /** Optional session data for richer main-agent rendering (model, cwd,
   *  cost). Subagent display ignores this. When omitted, the card falls
   *  back to the original minimal layout. */
  session?: Session;
  /** Project group root (see `projectRoots`) so the badge colour matches the
   *  board's tabs; defaults to the session's own cwd. */
  projectRoot?: string;
  label?: string;
  onClick?: () => void;
  /** `card` (default) is the full layout; `row` is a single line. */
  variant?: "card" | "row";
}

export function AgentCard({
  agent,
  session,
  projectRoot,
  label,
  onClick,
  variant = "card",
}: AgentCardProps) {
  const { t } = useTranslation("kanban");
  const isWaiting = agent.status === "waiting" || isAgentAwaitingInput(agent);
  const status = effectiveAgentStatus(agent);
  const isActive = agent.status === "working";
  const isMain = agent.type === "main";

  // Cost shown on the card is scoped to what the card represents: a main agent's
  // card stands in for the whole session, so it shows the session total; a
  // subagent's card shows that subagent's OWN cost (server-computed from its
  // token buckets). Showing the session total on a subagent card is misleading —
  // it reads as if that one subagent cost the whole session's spend. A subagent
  // with no recorded usage shows no cost (the cost > 0 guard below hides it),
  // which is truthful rather than misleading.
  const cost = isMain
    ? typeof session?.cost === "number"
      ? session.cost
      : 0
    : typeof agent.cost === "number"
      ? agent.cost
      : 0;
  // Real (user-given) session name - auto-generated Claude/Codex fallbacks
  // carry no extra info next to the ID, so they are suppressed.
  const sessionName = session?.name?.trim() || "";
  const realSessionName = /^(Session [0-9a-f]{8}|Codex session)$/i.test(sessionName)
    ? ""
    : sessionName;
  const isCodexMain = isMain && session?.provider === "codex" && agent.name.trim() === "Codex";
  const displayName = isCodexMain
    ? `Codex · ${realSessionName || agent.session_id.slice(0, 8)}`
    : isMain
      ? mainAgentDisplayName(agent.name, realSessionName)
      : agent.name;
  // Session titles and requests are intentionally independent: Claude and
  // Codex both persist two recent real human turns on the session, while a
  // main-agent task remains the truthful fallback for pre-preview history.
  // Subagents keep their own assigned task instead of inheriting the parent.
  const taskPreview = isMain
    ? session?.prompt_preview?.trim() || agent.task?.trim() || null
    : agent.task?.trim() || null;
  const taskPreviewLines = promptPreviewLines(taskPreview);
  const isTransient = isTransientProcess(agent.metadata);
  // A subagent's own model lives in its metadata (resolved from its transcript,
  // not the parent session's — see issue #185). Use it everywhere this card
  // shows a model so a Haiku QA agent under an Opus orchestrator reads as
  // Haiku, not Opus. Falls back to the session model only for the main agent.
  let subagentModel: string | null = null;
  if (!isMain && agent.metadata) {
    try {
      const parsed = JSON.parse(agent.metadata) as { model?: string };
      subagentModel = parsed?.model || null;
    } catch {
      subagentModel = null;
    }
  }
  // The model badge (footer) must reflect THIS card's agent: the session model
  // for main, the subagent's own model for subagents.
  const modelId = (isMain ? session?.model : subagentModel) || null;
  const displayModel = formatModelName(modelId);
  // Model now lives in the footer badge and the project in its own badge row,
  // so the subtitle carries what's left: for main, how many agents the session
  // spawned + how many turns it has run; subagents show their type. (No model
  // here — that would duplicate the footer badge, which is what main cards
  // used to do.)
  const agentCount = typeof session?.agent_count === "number" ? session.agent_count : 0;
  // agent_count includes the main agent itself. Show how many SUBAGENTS the
  // session spawned instead, so this reconciles with the "Active Subagents"
  // dashboard stat (which excludes main agents) — otherwise a card reading
  // "29 agents" looks like it should equal a 29-subagent stat when the session
  // actually has 28 subagents + 1 main.
  const subagentCount = Math.max(0, agentCount - 1);
  let sessionTurns = 0;
  if (isMain && session?.metadata) {
    try {
      const m = JSON.parse(session.metadata) as { turn_count?: number };
      if (typeof m?.turn_count === "number") sessionTurns = m.turn_count;
    } catch {
      sessionTurns = 0;
    }
  }
  const subtitle = isMain
    ? [
        subagentCount > 0 ? t("kanban:session.subagentSummary", { count: subagentCount }) : null,
        sessionTurns > 0 ? t("kanban:session.turnSummary", { count: sessionTurns }) : null,
      ]
        .filter(Boolean)
        .join(" · ") || null
    : label || agent.subagent_type || null;

  const reason = agentAwaitingReason(agent);

  // Surface click: `onClick` wins (SessionDetail opens the conversation);
  // otherwise the session page. A transient process has no durable id yet.
  const to = onClick || isTransient ? undefined : routes.session(agent.session_id);
  const menu = isTransient
    ? undefined
    : entityMenu(
        { kind: "agent", id: agent.id, sessionId: agent.session_id, type: agent.type },
        { t, copy: copyText }
      );
  // With `onClick` given, Enter on the name must run it (SessionDetail opens
  // the agent's conversation) rather than re-navigate to the agents tab via
  // EntityRef's href — the kebab menu still carries the entity actions.
  const nameRef = isTransient ? (
    displayName
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="text-left truncate hover:underline decoration-dotted"
    >
      {displayName}
    </button>
  ) : (
    <EntityRef
      kind="agent"
      id={agent.id}
      sessionId={agent.session_id}
      type={agent.type}
      mono={false}
      className="text-gray-200"
    >
      {displayName}
    </EntityRef>
  );
  const accent = isWaiting
    ? "border-l-2 border-l-yellow-500/60"
    : isActive
      ? "border-l-2 border-l-emerald-500/50"
      : "";

  if (variant === "row") {
    const ts = agent.ended_at || agent.last_activity || agent.updated_at || agent.started_at;
    // Main-agent rows otherwise show only the model, unlike SessionCard's row
    // (which always names the project) — prepend the project folder here too.
    const projectPart = isMain ? pathBasename(session?.cwd) : null;
    const rowSubtitle = [projectPart, isMain ? null : label || agent.subagent_type, displayModel]
      .filter(Boolean)
      .join(" · ");
    return (
      <CompactRow
        to={to}
        onActivate={onClick}
        menu={menu}
        menuLabel={t("common:ui.openMenuFor", { name: displayName })}
        accent={accent}
        badge={
          <AgentStatusBadge status={status} reason={reason} provider={session?.provider} compact />
        }
        name={nameRef}
        subtitle={rowSubtitle}
        subtitleTitle={projectPart ? (session?.cwd ?? undefined) : undefined}
        chip={
          agent.current_tool && (
            <EntityRef
              kind="tool"
              name={agent.current_tool}
              sessionId={agent.session_id}
              className="max-w-[8rem] min-w-0"
            />
          )
        }
        progress={
          session?.todo_summary && <TodoProgressIndicator progress={session.todo_summary} />
        }
        ts={ts}
      />
    );
  }

  // Card layout is block-level, so the kebab lives in the header cluster
  // instead of Clickable's default last-child slot.
  return (
    <Clickable
      to={to}
      onActivate={onClick}
      menu={menu}
      kebab={false}
      className={`group card-hover p-4 overflow-hidden ${isTransient ? "cursor-default" : ""} ${accent}`}
    >
      <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
              isMain ? "bg-accent/15 text-accent" : "bg-violet-500/15 text-violet-400"
            }`}
          >
            {isMain ? <Bot className="w-3.5 h-3.5" /> : <GitBranch className="w-3.5 h-3.5" />}
          </div>
          <div className="min-w-0 overflow-hidden">
            <p className="text-sm font-medium text-gray-200 truncate">
              {/* Auto-generated main-agent titles (e.g. "Main Agent - Session
                  229d93fd" or "Main Agent - work - e3f8e613") swap the
                  placeholder for the real session name when one exists. Codex
                  main agents use their native renamed title (or short ID) so
                  a board never shows a bare, indistinguishable "Codex". */}
              {nameRef}
            </p>
            {subtitle && <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>}
          </div>
        </div>
        {/* compact: cards are narrow — inline reason chip would squeeze the
            title, so the reason stays hover-tooltip-only here. */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {session?.todo_summary && (
            <TodoProgressIndicator progress={session.todo_summary} stopClickPropagation />
          )}
          <AgentStatusBadge status={status} reason={reason} provider={session?.provider} compact />
          {menu && (
            <MenuButton
              size="xs"
              items={menu}
              label={t("common:ui.openMenuFor", { name: displayName })}
              reveal
            />
          )}
        </div>
      </div>

      {session?.cwd && (
        <div className="mb-3 flex min-w-0">
          <ProjectBadge cwd={session.cwd} root={projectRoot} source={session.source} />
        </div>
      )}

      {taskPreviewLines.length > 0 && (
        <div className="mb-3 space-y-1 border-l-2 border-accent/25 pl-2.5">
          {taskPreviewLines.map((prompt, index) => (
            <p
              key={`${index}-${prompt}`}
              className="text-xs text-gray-400 leading-relaxed line-clamp-1"
              title={prompt}
            >
              {prompt}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-gray-500 min-w-0 overflow-hidden flex-wrap">
        {agent.current_tool && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Wrench className="w-3 h-3" />
            <EntityRef kind="tool" name={agent.current_tool} sessionId={agent.session_id} />
          </span>
        )}
        {/* Model badge - shown on every card when no tool is currently
            running (avoids clutter on actively-running agents that already
            display the running tool name). Uses the agent's OWN model:
            session model for main, the subagent's resolved model otherwise. */}
        {modelId && displayModel && !agent.current_tool && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Cpu className="w-3 h-3" />
            <EntityRef kind="model" model={modelId}>
              {displayModel}
            </EntityRef>
          </span>
        )}
        {cost > 0 && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Coins className="w-3 h-3" />
            {fmtCost(cost)}
          </span>
        )}
        {agent.ended_at ? (
          <>
            <span className="flex items-center gap-1 flex-shrink-0">
              <Clock className="w-3 h-3" />
              {t("ran")}
              {formatDuration(agent.started_at, agent.ended_at)}
            </span>
            <span className="text-gray-600 flex-shrink-0">{timeAgo(agent.ended_at)}</span>
          </>
        ) : (
          <span className="flex items-center gap-1 flex-shrink-0">
            <Clock className="w-3 h-3" />
            {timeAgo(agent.last_activity || agent.updated_at || agent.started_at)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 min-w-0 opacity-50">
          {realSessionName && !isCodexMain && (
            <span className="truncate max-w-[10rem]">{realSessionName} ·</span>
          )}
          <EntityRef
            kind="session"
            id={agent.session_id}
            name={session?.name}
            cwd={session?.cwd}
            source={session?.source}
            transient={isTransient}
            className="flex-shrink-0"
          >
            {agent.session_id.slice(0, 8)}
          </EntityRef>
        </span>
      </div>
    </Clickable>
  );
}
