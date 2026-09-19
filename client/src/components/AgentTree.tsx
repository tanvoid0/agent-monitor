/**
 * @file AgentTree.tsx
 * @description Recursive main → subagent tree renderer shared by the Dashboard
 * "Active agents" column and the SessionDetail agents tab. Owns the chrome that
 * both pages used to duplicate: the expand/collapse chevron (`aria-expanded`,
 * translated label), the GitBranch marker on nested rows, the indented
 * `border-l` children block, the collapsed "N subagents" expander button, the
 * `id="agent-<id>"` / `tabIndex={-1}` wrapper that `#agent-<id>` deep links
 * flash and focus, and the visited-set guard that keeps a cyclic
 * `parent_agent_id` (corrupt data) from stack-overflowing the page.
 *
 * Callers keep everything that differs between them: which agents are roots,
 * how `childrenByParent` is built and sorted, the expanded-id state, the card
 * itself (`renderCard`), the collapsed-button copy (`collapsedLabel`, handed
 * the full descendant list so it can count active ones), and the optional
 * slot rendered in the chevron column for leaf rows (`leafSlot`).
 *
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { IconButton } from "./ui";
import type { Agent } from "../lib/types";

export interface AgentTreeProps {
  /** Top-level nodes; each is rendered at `depth` with its subtree below it. */
  roots: Agent[];
  /** parent id → direct children (already sorted by the caller). */
  childrenByParent: Map<string, Agent[]>;
  /** Ids whose children block is open. */
  expanded: Set<string>;
  /** Chevron / collapsed-button click; the caller flips membership in `expanded`. */
  onToggle: (id: string) => void;
  /** Accessible chevron labels; default to `common:subagents.expand/collapse`
   *  so callers don't each need their own copy of the same string. */
  expandLabel?: string;
  collapseLabel?: string;
  /** The row card; `depth` is 0 for roots. */
  renderCard: (agent: Agent, depth: number) => ReactNode;
  /** Contents of the collapsed expander button; `descendants` is the full subtree. */
  collapsedLabel: (agent: Agent, descendants: Agent[]) => ReactNode;
  /** Optional filler for the chevron column on rows without children. */
  leafSlot?: (agent: Agent, depth: number) => ReactNode;
  /** Depth the roots render at (SessionDetail renders orphans at 1). */
  depth?: number;
}

/** Every transitive child of `id`, guarded against cyclic links. */
function collectDescendants(
  id: string,
  childrenByParent: Map<string, Agent[]>,
  seen = new Set<string>([id])
): Agent[] {
  const out: Agent[] = [];
  for (const kid of childrenByParent.get(id) || []) {
    if (seen.has(kid.id)) continue;
    seen.add(kid.id);
    out.push(kid, ...collectDescendants(kid.id, childrenByParent, seen));
  }
  return out;
}

export function AgentTree({
  roots,
  childrenByParent,
  expanded,
  onToggle,
  expandLabel,
  collapseLabel,
  renderCard,
  collapsedLabel,
  leafSlot,
  depth: rootDepth = 0,
}: AgentTreeProps) {
  const { t } = useTranslation("common");
  const resolvedExpandLabel = expandLabel ?? t("subagents.expand");
  const resolvedCollapseLabel = collapseLabel ?? t("subagents.collapse");

  function renderNode(agent: Agent, depth: number, ancestors: Set<string>): ReactNode {
    // Guard against a cyclic parent_agent_id (corrupt data) so the recursive
    // render can't stack-overflow the page.
    if (ancestors.has(agent.id)) return null;
    const childAncestors = new Set(ancestors).add(agent.id);
    const children = childrenByParent.get(agent.id) || [];
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(agent.id);
    const isSubagent = depth > 0;

    return (
      <div key={agent.id}>
        <div className="flex items-center gap-1 min-w-0">
          {hasChildren && (
            <IconButton
              size="xs"
              icon={isExpanded ? ChevronDown : ChevronRight}
              label={isExpanded ? resolvedCollapseLabel : resolvedExpandLabel}
              aria-expanded={isExpanded}
              onClick={() => onToggle(agent.id)}
              className="flex-shrink-0"
            />
          )}
          {!hasChildren && leafSlot?.(agent, depth)}
          {isSubagent && <GitBranch className="w-3 h-3 text-violet-400 flex-shrink-0" />}
          <div
            id={`agent-${agent.id}`}
            tabIndex={-1}
            className="flex-1 min-w-0 rounded-xl transition-shadow"
          >
            {renderCard(agent, depth)}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="ml-6 mt-1 space-y-1 border-l-2 border-violet-500/20 pl-3">
            {children.map((child) => renderNode(child, depth + 1, childAncestors))}
          </div>
        )}

        {hasChildren && !isExpanded && (
          <button
            onClick={() => onToggle(agent.id)}
            className="ml-7 mt-1 text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
          >
            {collapsedLabel(agent, collectDescendants(agent.id, childrenByParent))}
          </button>
        )}
      </div>
    );
  }

  return <>{roots.map((agent) => renderNode(agent, rootDepth, new Set()))}</>;
}
