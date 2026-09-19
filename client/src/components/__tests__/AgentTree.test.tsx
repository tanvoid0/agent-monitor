/**
 * @file AgentTree.test.tsx
 * @description Unit tests for the shared AgentTree renderer: nested nodes render
 * under their parent when expanded, the chevron and collapsed-count button both
 * report through `onToggle`, the collapsed button shows the full descendant
 * count, and every row exposes the `agent-<id>` deep-link wrapper.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentTree } from "../AgentTree";
import type { Agent } from "../../lib/types";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a",
    session_id: "s",
    name: "Agent",
    type: "subagent",
    subagent_type: null,
    status: "working",
    task: null,
    current_tool: null,
    started_at: "2026-03-05T10:00:00.000Z",
    ended_at: null,
    updated_at: "2026-03-05T10:00:00.000Z",
    parent_agent_id: null,
    metadata: null,
    ...overrides,
  };
}

const main = makeAgent({ id: "main", name: "Main", type: "main" });
const child = makeAgent({ id: "child", name: "Child", parent_agent_id: "main" });
const grandchild = makeAgent({ id: "grandchild", name: "Grandchild", parent_agent_id: "child" });
const childrenByParent = new Map<string, Agent[]>([
  ["main", [child]],
  ["child", [grandchild]],
]);

function renderTree(expanded: Set<string>, onToggle = vi.fn()) {
  render(
    <AgentTree
      roots={[main]}
      childrenByParent={childrenByParent}
      expanded={expanded}
      onToggle={onToggle}
      expandLabel="Expand subagents"
      collapseLabel="Collapse subagents"
      renderCard={(agent, depth) => <span data-depth={depth}>{agent.name}</span>}
      collapsedLabel={(_agent, descendants) => `${descendants.length} subagents`}
    />
  );
  return onToggle;
}

describe("AgentTree", () => {
  it("renders nested nodes under an expanded parent with deep-link wrappers", () => {
    renderTree(new Set(["main", "child"]));
    expect(screen.getByText("Main")).toHaveAttribute("data-depth", "0");
    expect(screen.getByText("Child")).toHaveAttribute("data-depth", "1");
    expect(screen.getByText("Grandchild")).toHaveAttribute("data-depth", "2");
    expect(document.getElementById("agent-grandchild")).toHaveAttribute("tabindex", "-1");
    expect(screen.getAllByLabelText("Collapse subagents")).toHaveLength(2);
  });

  it("hides children when collapsed and shows the descendant count", () => {
    const onToggle = renderTree(new Set());
    expect(screen.queryByText("Child")).not.toBeInTheDocument();
    const chevron = screen.getByLabelText("Expand subagents");
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chevron);
    expect(onToggle).toHaveBeenCalledWith("main");

    fireEvent.click(screen.getByText("2 subagents"));
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith("main");
  });
});
