/**
 * @file useSessionDeepLinks.test.tsx
 * @description Tests for the session detail deep-link hook: `?tool_name=` /
 * `?agent_id=` seed the filters once and leave the URL, `?event=` expands a
 * loaded row / pulls one more batch / reports a missing row exactly once,
 * `#agent-<id>` expands the target with its ancestors and flashes the card
 * only once it exists, and bookkeeping resets when the session id changes.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { useSessionDeepLinks, agentIdFromHash } from "../useSessionDeepLinks";
import type { SessionDeepLinksOptions } from "../useSessionDeepLinks";
import { EMPTY_FILTERS } from "../../components/EventFilters";
import type { EventFiltersValue } from "../../components/EventFilters";
import type { Agent, DashboardEvent } from "../../lib/types";

function agent(id: string, parent: string | null = null): Agent {
  return {
    id,
    session_id: "s1",
    name: id,
    type: parent ? "subagent" : "main",
    subagent_type: null,
    status: "completed",
    task: null,
    current_tool: null,
    started_at: "2026-08-26T10:00:00.000Z",
    ended_at: null,
    updated_at: "2026-08-26T10:00:00.000Z",
    parent_agent_id: parent,
    metadata: null,
  };
}

function event(id: number): DashboardEvent {
  return {
    id,
    session_id: "s1",
    agent_id: "main",
    event_type: "PreToolUse",
    tool_name: "Read",
    summary: null,
    data: null,
    timestamp: "2026-08-26T10:00:00.000Z",
    created_at: "2026-08-26T10:00:00.000Z",
  } as DashboardEvent;
}

type Overrides = Partial<
  Pick<
    SessionDeepLinksOptions,
    "sessionId" | "agents" | "events" | "eventsTotal" | "eventsLoaded" | "eventsLoadingMore"
  >
>;

/** Renders the hook with real page-like state so its setters are observable. */
function setup(url: string, initial: Overrides = {}) {
  const loadMoreEvents = vi.fn(() => Promise.resolve());
  const onEventNotLoaded = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  const hook = renderHook(
    (props: Overrides) => {
      const [filters, setFilters] = useState<EventFiltersValue>(EMPTY_FILTERS);
      const [expandedEvents, setExpandedEvents] = useState<Set<number>>(() => new Set());
      const [expandedAgents, setExpandedAgents] = useState<Set<string>>(() => new Set());
      useSessionDeepLinks({
        sessionId: "s1",
        agents: [],
        events: [],
        eventsTotal: 0,
        eventsLoaded: false,
        eventsLoadingMore: false,
        ...props,
        expandedAgents,
        loadMoreEvents,
        setFilters,
        setExpandedEvents,
        setExpandedAgents,
        onEventNotLoaded,
      });
      return { filters, expandedEvents, expandedAgents, search: useLocation().search };
    },
    { wrapper, initialProps: initial }
  );
  return { ...hook, loadMoreEvents, onEventNotLoaded };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agentIdFromHash", () => {
  it("decodes #agent-<id> and rejects anything else", () => {
    expect(agentIdFromHash("#agent-a%20b")).toBe("a b");
    expect(agentIdFromHash("#other")).toBe("");
    expect(agentIdFromHash("#agent-%E0")).toBe("");
  });
});

describe("useSessionDeepLinks", () => {
  it("seeds the filters from ?tool_name / ?agent_id once and strips them from the URL", () => {
    const { result } = setup("/sessions/s1?tab=timeline&tool_name=Read&agent_id=sub-1");
    expect(result.current.filters.tool_name).toEqual(["Read"]);
    expect(result.current.filters.agent_id).toEqual(["sub-1"]);
    expect(result.current.search).toBe("?tab=timeline");
  });

  it("expands and flashes a loaded ?event row once", () => {
    const row = document.createElement("div");
    row.id = "event-7";
    document.body.appendChild(row);
    try {
      const { result, rerender } = setup("/sessions/s1?event=7");
      expect(result.current.expandedEvents.size).toBe(0);
      rerender({ events: [event(7)], eventsTotal: 1, eventsLoaded: true });
      expect(result.current.expandedEvents.has(7)).toBe(true);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      rerender({ events: [event(7)], eventsTotal: 1, eventsLoaded: true });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      row.remove();
    }
  });

  it("pulls one more batch for a missing ?event, then reports it once", () => {
    const { result, rerender, loadMoreEvents, onEventNotLoaded } = setup("/sessions/s1?event=9", {
      events: [event(1)],
      eventsTotal: 3,
      eventsLoaded: true,
    });
    expect(loadMoreEvents).toHaveBeenCalledTimes(1);
    expect(onEventNotLoaded).not.toHaveBeenCalled();
    rerender({ events: [event(1), event(2)], eventsTotal: 3, eventsLoaded: true });
    expect(loadMoreEvents).toHaveBeenCalledTimes(1);
    expect(onEventNotLoaded).toHaveBeenCalledWith("9");
    rerender({ events: [event(1), event(2)], eventsTotal: 3, eventsLoaded: true });
    expect(onEventNotLoaded).toHaveBeenCalledTimes(1);
    expect(result.current.expandedEvents.size).toBe(0);
  });

  it("expands a hashed agent with its ancestors and flashes the card once it exists", () => {
    const agents = [agent("main"), agent("mid", "main"), agent("leaf", "mid")];
    const card = document.createElement("div");
    card.id = "agent-leaf";
    document.body.appendChild(card);
    try {
      const { result, rerender } = setup("/sessions/s1#agent-leaf", { agents });
      expect(result.current.expandedAgents).toEqual(new Set(["leaf", "mid", "main"]));
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(card.classList.contains("ring-2")).toBe(true);
      rerender({ agents: [...agents] });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      card.remove();
    }
  });

  it("holds the flash while the hashed card is not in the DOM yet", () => {
    const agents = [agent("main"), agent("leaf", "main")];
    const { result } = setup("/sessions/s1#agent-leaf", { agents });
    expect(result.current.expandedAgents).toEqual(new Set(["leaf", "main"]));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("forgets handled ?event bookkeeping when the session id changes", () => {
    const { rerender, onEventNotLoaded } = setup("/sessions/s1?event=9", {
      events: [event(1)],
      eventsTotal: 1,
      eventsLoaded: true,
    });
    expect(onEventNotLoaded).toHaveBeenCalledTimes(1);
    rerender({ sessionId: "s2", events: [event(1)], eventsTotal: 1, eventsLoaded: true });
    expect(onEventNotLoaded).toHaveBeenCalledTimes(2);
  });
});
