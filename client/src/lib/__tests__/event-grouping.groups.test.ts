/**
 * @file event-grouping.groups.test.ts
 * @description Locks down `groupEvents`, the "Group by tool call" run-collapse
 * used by Session Detail's Timeline tab and Activity Feed: consecutive
 * non-tool events of the same `event_type` collapse into one `run`, broken by
 * any tool call or a change in `event_type` (#99).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect } from "vitest";
import { groupEvents } from "../event-grouping";
import type { DashboardEvent } from "../types";

function ev(overrides: Partial<DashboardEvent>): DashboardEvent {
  return {
    id: 0,
    session_id: "s1",
    agent_id: null,
    event_type: "TurnDuration",
    tool_name: null,
    summary: null,
    data: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as DashboardEvent;
}

describe("groupEvents", () => {
  it("collapses a flood of consecutive same-type non-tool events into one run", () => {
    const events = [1, 2, 3, 4].map((id) => ev({ id, event_type: "TurnDuration" }));
    const groups = groupEvents(events);
    expect(groups).toEqual([{ isRun: true, eventType: "TurnDuration", events }]);
  });

  it("leaves a lone non-tool event ungrouped rather than wrapping a 1-item run", () => {
    const event = ev({ id: 1, event_type: "Notification" });
    expect(groupEvents([event])).toEqual([{ isRun: false, event }]);
  });

  it("a tool call always stands alone and breaks the current run", () => {
    const a = ev({ id: 1, event_type: "TurnDuration" });
    const b = ev({ id: 2, event_type: "TurnDuration" });
    const tool = ev({ id: 3, event_type: "PreToolUse", tool_name: "Bash" });
    const c = ev({ id: 4, event_type: "TurnDuration" });
    const d = ev({ id: 5, event_type: "TurnDuration" });
    expect(groupEvents([a, b, tool, c, d])).toEqual([
      { isRun: true, eventType: "TurnDuration", events: [a, b] },
      { isRun: false, event: tool },
      { isRun: true, eventType: "TurnDuration", events: [c, d] },
    ]);
  });

  it("a change in event_type breaks the run even without a tool call between", () => {
    const a = ev({ id: 1, event_type: "TurnDuration" });
    const b = ev({ id: 2, event_type: "TurnDuration" });
    const c = ev({ id: 3, event_type: "Notification" });
    const d = ev({ id: 4, event_type: "Notification" });
    expect(groupEvents([a, b, c, d])).toEqual([
      { isRun: true, eventType: "TurnDuration", events: [a, b] },
      { isRun: true, eventType: "Notification", events: [c, d] },
    ]);
  });

  it("returns an empty array for no events", () => {
    expect(groupEvents([])).toEqual([]);
  });
});
