/**
 * @file entityMenu.test.ts
 * @description Tests for the pure entity helpers: primary href and raw value
 * per kind, project label/sub-path split, and the menu items `entityMenu`
 * builds (order, conditional items, copy targets, lazy folder reveal with
 * success/failure toasts).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TFunction } from "i18next";
import { ACTION_TOAST_EVENT } from "../../../lib/appEvents";
import { api } from "../../../lib/api";
import { entityHref, entityMenu, entityValue } from "../entityMenu";
import { projectParts } from "../../../lib/project";
import type { EntityTarget } from "../entityMenu";
import type { MenuItem } from "../../ui";

const { openCwd } = vi.hoisted(() => ({ openCwd: vi.fn() }));
vi.mock("../../../lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../lib/api")>();
  return { ...mod, api: { ...mod.api, sessions: { ...mod.api.sessions, openCwd } } };
});

// Identity translator: labels come back as their key so tests read the shape.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;
const copy = vi.fn(async (_text: string) => true);
const ctx = { t, copy };

const labels = (items: MenuItem[]) =>
  items.map((i) => ("type" in i ? (i.type === "separator" ? "—" : `label:${i.label}`) : i.label));
const find = (items: MenuItem[], label: string) =>
  items.find(
    (i): i is Extract<MenuItem, { onSelect?: unknown }> => !("type" in i) && i.label === label
  );

beforeEach(() => {
  copy.mockClear();
  openCwd.mockReset();
});

describe("entityHref / entityValue", () => {
  it.each<[EntityTarget, string, string]>([
    [{ kind: "session", id: "s1" }, "/sessions/s1", "s1"],
    [
      { kind: "agent", id: "a1", sessionId: "s1", type: "main" },
      "/sessions/s1?tab=agents#agent-a1",
      "a1",
    ],
    [{ kind: "project", cwd: "/w/repo" }, "/sessions?cwd=%2Fw%2Frepo", "/w/repo"],
    [{ kind: "tool", name: "Bash" }, "/activity?tool_name=Bash", "Bash"],
    [
      { kind: "tool", name: "Bash", sessionId: "s1" },
      "/activity?session_id=s1&tool_name=Bash",
      "Bash",
    ],
    [{ kind: "eventType", type: "PreToolUse" }, "/activity?event_type=PreToolUse", "PreToolUse"],
    [{ kind: "model", model: "claude-opus-4" }, "/analytics?tab=cost", "claude-opus-4"],
    [{ kind: "event", id: 42, sessionId: "s1" }, "/sessions/s1?tab=timeline&event=42", "42"],
  ])("%o", (ref, href, value) => {
    expect(entityHref(ref)).toBe(href);
    expect(entityValue(ref)).toBe(value);
  });
});

describe("projectParts", () => {
  it("splits a worktree cwd into repo name and sub-path (Windows separators too)", () => {
    expect(projectParts("D:\\w\\repo\\.claude\\worktrees\\lane")).toEqual({
      label: "repo",
      sub: ".claude/worktrees/lane",
    });
    expect(projectParts("/w/repo")).toEqual({ label: "repo", sub: "" });
  });
});

describe("entityMenu", () => {
  it("session: full set with cwd, local source", () => {
    const items = entityMenu({ kind: "session", id: "s1", cwd: "/w/repo" }, ctx);
    expect(labels(items)).toEqual([
      "label:s1",
      "common:ui.menu.open",
      "common:ui.menu.openConversation",
      "common:ui.menu.openTimeline",
      "—",
      "common:ui.menu.showInActivity",
      "common:ui.menu.sessionsInProject",
      "common:ui.menu.showOnBoard",
      "common:ui.menu.resumeInRun",
      "—",
      "common:ui.menu.copySessionId",
      "common:ui.menu.copyPath",
      "common:ui.menu.copyLink",
      "common:ui.menu.revealFolder",
    ]);
    expect(find(items, "common:ui.menu.openConversation")?.to).toBe(
      "/sessions/s1?tab=conversation&transcript=main"
    );
    expect(find(items, "common:ui.menu.showOnBoard")?.to).toBe("/kanban?project=%2Fw%2Frepo");
    expect(find(items, "common:ui.menu.resumeInRun")?.to).toBe("/run?session=s1");
  });

  it("session: drops cwd items without cwd and reveal for remote sources", () => {
    expect(labels(entityMenu({ kind: "session", id: "s1" }, ctx))).not.toEqual(
      expect.arrayContaining(["common:ui.menu.copyPath", "common:ui.menu.revealFolder"])
    );
    const remote = entityMenu({ kind: "session", id: "s1", cwd: "/w", source: "remote" }, ctx);
    expect(labels(remote)).toContain("common:ui.menu.copyPath");
    expect(labels(remote)).not.toContain("common:ui.menu.revealFolder");
  });

  it("agent: main opens the main transcript, others their own", () => {
    const main = entityMenu({ kind: "agent", id: "a1", sessionId: "s1", type: "main" }, ctx);
    expect(labels(main)).toEqual([
      "label:a1",
      "common:ui.menu.openConversation",
      "common:ui.menu.openEvents",
      "common:ui.menu.openSession",
      "common:ui.menu.showInActivity",
      "—",
      "common:ui.menu.copyAgentId",
      "common:ui.menu.copySessionId",
      "common:ui.menu.copyLink",
    ]);
    expect(find(main, "common:ui.menu.openConversation")?.to).toBe(
      "/sessions/s1?tab=conversation&transcript=main"
    );
    const sub = entityMenu({ kind: "agent", id: "a2", sessionId: "s1", type: "worker" }, ctx);
    expect(find(sub, "common:ui.menu.openConversation")?.to).toBe(
      "/sessions/s1?tab=conversation&transcript=a2"
    );
    expect(find(sub, "common:ui.menu.openEvents")?.to).toBe(
      "/sessions/s1?tab=timeline&agent_id=a2"
    );
  });

  it("tool / eventType / model / event shapes", () => {
    expect(labels(entityMenu({ kind: "tool", name: "Bash", sessionId: "s1" }, ctx))).toEqual([
      "label:Bash",
      "common:ui.menu.showInActivity",
      "common:ui.menu.filterByTool",
      "—",
      "common:ui.menu.copyToolName",
    ]);
    expect(labels(entityMenu({ kind: "tool", name: "Bash" }, ctx))).not.toContain(
      "common:ui.menu.filterByTool"
    );
    expect(labels(entityMenu({ kind: "eventType", type: "Stop" }, ctx))).toEqual([
      "label:Stop",
      "common:ui.menu.showInActivity",
      "—",
      "common:ui.menu.copyEventType",
    ]);
    const model = entityMenu({ kind: "model", model: "m" }, ctx);
    expect(labels(model)).toEqual([
      "label:m",
      "common:ui.menu.costAnalytics",
      "common:ui.menu.pricingRules",
      "—",
      "common:ui.menu.copyModelId",
    ]);
    expect(find(model, "common:ui.menu.pricingRules")?.to).toBe("/settings#claude-pricing");
    const event = entityMenu(
      { kind: "event", id: 7, sessionId: "s1", toolName: "Read", agentId: "a1" },
      ctx
    );
    expect(labels(event)).toEqual([
      "label:7",
      "common:ui.menu.openTimeline",
      "common:ui.menu.showInActivity",
      "common:ui.menu.filterByTool",
      "common:ui.menu.openAgent",
      "—",
      "common:ui.menu.copyEventId",
      "common:ui.menu.copyLink",
    ]);
    expect(find(event, "common:ui.menu.openAgent")?.to).toBe("/sessions/s1?tab=agents#agent-a1");
    expect(labels(entityMenu({ kind: "event", id: 7, sessionId: "s1" }, ctx))).not.toEqual(
      expect.arrayContaining(["common:ui.menu.filterByTool", "common:ui.menu.openAgent"])
    );
  });

  it("copy items copy the raw value; copy link copies the absolute primary href", async () => {
    const items = entityMenu({ kind: "session", id: "s1", cwd: "/w/repo" }, ctx);
    await find(items, "common:ui.menu.copySessionId")?.onSelect?.();
    await find(items, "common:ui.menu.copyPath")?.onSelect?.();
    await find(items, "common:ui.menu.copyLink")?.onSelect?.();
    expect(copy.mock.calls.map((c) => c[0])).toEqual([
      "s1",
      "/w/repo",
      `${window.location.origin}/sessions/s1`,
    ]);
  });

  it("reveal folder calls api.sessions.openCwd lazily and toasts the outcome", async () => {
    const toasts: string[] = [];
    const onToast = (e: Event) => toasts.push((e as CustomEvent<string>).detail);
    window.addEventListener(ACTION_TOAST_EVENT, onToast);
    try {
      const items = entityMenu({ kind: "project", cwd: "/w/repo" }, ctx);
      expect(openCwd).not.toHaveBeenCalled();
      openCwd.mockResolvedValueOnce({ ok: true, cwd: "/w/repo" });
      await find(items, "common:ui.menu.revealFolder")?.onSelect?.();
      expect(api.sessions.openCwd).toHaveBeenCalledWith("/w/repo");
      openCwd.mockRejectedValueOnce(new Error("nope"));
      await find(items, "common:ui.menu.revealFolder")?.onSelect?.();
      expect(toasts).toEqual([
        'kanban:project.opened:{"name":"repo"}',
        'kanban:project.openFailed:{"message":"nope"}',
      ]);
    } finally {
      window.removeEventListener(ACTION_TOAST_EVENT, onToast);
    }
  });

  it("reveal folder prefers ctx.openCwd when given", async () => {
    const custom = vi.fn(async () => undefined);
    const items = entityMenu({ kind: "project", cwd: "/w/repo" }, { ...ctx, openCwd: custom });
    await find(items, "common:ui.menu.revealFolder")?.onSelect?.();
    expect(custom).toHaveBeenCalledWith("/w/repo");
    expect(openCwd).not.toHaveBeenCalled();
  });
});
