/**
 * @file routes.test.ts
 * @description Unit tests for the typed href builders in `lib/routes.ts`: param names,
 * encoding, omission of empty values, repeated `cwd` params, forced session tabs, the
 * `#agent-<id>` hash, and `absoluteHref`.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect } from "vitest";
import { routes, absoluteHref } from "../routes";

describe("routes.sessions", () => {
  it("returns the bare path without a query", () => {
    expect(routes.sessions()).toBe("/sessions");
    expect(routes.sessions({})).toBe("/sessions");
  });

  it("repeats cwd for arrays and encodes every value", () => {
    expect(routes.sessions({ status: "active", cwd: ["/a,b", "D:\\x"], q: "hi there" })).toBe(
      "/sessions?status=active&cwd=%2Fa%2Cb&cwd=D%3A%5Cx&q=hi%20there"
    );
    expect(routes.sessions({ cwd: "/one" })).toBe("/sessions?cwd=%2Fone");
  });

  it("omits undefined and empty values", () => {
    expect(routes.sessions({ status: "", cwd: [], q: undefined })).toBe("/sessions");
  });
});

describe("routes.session", () => {
  it("links the bare session and encodes the id", () => {
    expect(routes.session("abc")).toBe("/sessions/abc");
    expect(routes.session("a/b")).toBe("/sessions/a%2Fb");
    expect(routes.session("abc", { tab: "conversation" })).toBe("/sessions/abc?tab=conversation");
  });

  it("forces the agents tab and emits the hash for agent", () => {
    expect(routes.session("s1", { agent: "ag-1", tab: "timeline" })).toBe(
      "/sessions/s1?tab=agents#agent-ag-1"
    );
  });

  it("forces the timeline tab for event, tool_name and agent_id", () => {
    expect(routes.session("s1", { event: 42 })).toBe("/sessions/s1?tab=timeline&event=42");
    expect(routes.session("s1", { event: "7" })).toBe("/sessions/s1?tab=timeline&event=7");
    expect(routes.session("s1", { tool_name: "Bash" })).toBe(
      "/sessions/s1?tab=timeline&tool_name=Bash"
    );
    expect(routes.session("s1", { agent_id: "ag-2" })).toBe(
      "/sessions/s1?tab=timeline&agent_id=ag-2"
    );
  });

  it("forces the conversation tab for transcript", () => {
    expect(routes.session("s1", { transcript: "main" })).toBe(
      "/sessions/s1?tab=conversation&transcript=main"
    );
  });
});

describe("routes.kanban / analytics / plan / run / settings", () => {
  it("kanban passes view, raw project cwd and density", () => {
    expect(routes.kanban()).toBe("/kanban");
    expect(routes.kanban({ view: "sessions", project: "/p/x", density: "rows" })).toBe(
      "/kanban?view=sessions&project=%2Fp%2Fx&density=rows"
    );
  });

  it("analytics tab", () => {
    expect(routes.analytics({ tab: "cost" })).toBe("/analytics?tab=cost");
    expect(routes.analytics()).toBe("/analytics");
  });

  it("plan slug and task", () => {
    expect(routes.plan()).toBe("/plan");
    expect(routes.plan("my plan", { task: "t 1" })).toBe("/plan/my%20plan?task=t%201");
  });

  it("run maps autostart:true to 1 and drops false", () => {
    expect(routes.run({ session: "s1", prompt: "a&b", autostart: true, cwd: "/w" })).toBe(
      "/run?session=s1&prompt=a%26b&autostart=1&cwd=%2Fw"
    );
    expect(routes.run({ autostart: false })).toBe("/run");
  });

  it("settings renders the section as a hash", () => {
    expect(routes.settings()).toBe("/settings");
    expect(routes.settings("claude-pricing")).toBe("/settings#claude-pricing");
  });
});

describe("routes.activity", () => {
  it("maps friendly keys to the feed's param names", () => {
    expect(
      routes.activity({
        session: "s1",
        agent: "a1,a2",
        tool: "Bash",
        type: "PreToolUse",
        status: "error",
        q: "x",
        from: "2026-01-01",
        to: "2026-01-02",
      })
    ).toBe(
      "/activity?session_id=s1&agent_id=a1%2Ca2&tool_name=Bash&event_type=PreToolUse&status=error&q=x&from=2026-01-01&to=2026-01-02"
    );
    expect(routes.activity()).toBe("/activity");
  });
});

describe("absoluteHref", () => {
  it("prefixes the current origin", () => {
    expect(absoluteHref("/sessions/s1")).toBe(`${window.location.origin}/sessions/s1`);
  });
});
