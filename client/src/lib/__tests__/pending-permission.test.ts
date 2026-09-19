/**
 * @file pending-permission.test.ts
 * @description Covers `inferPendingPermission`: the PreToolUse → Notification
 * pairing that reveals an unanswered prompt, and every way the events can say
 * "no, that one was answered".
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect } from "vitest";
import { inferPendingPermission } from "../pending-permission";
import type { DashboardEvent } from "../types";

let nextId = 1000;
function ev(
  event_type: string,
  data: Record<string, unknown> | null,
  tool_name: string | null = null
): DashboardEvent {
  const id = nextId--;
  return {
    id,
    session_id: "s",
    agent_id: null,
    event_type,
    tool_name,
    data: data ? JSON.stringify(data) : null,
    created_at: `2026-09-16T12:${String(id % 60).padStart(2, "0")}:00.000Z`,
    status: null,
  } as unknown as DashboardEvent;
}

const permissionNotif = () =>
  ev("Notification", {
    notification_type: "permission_prompt",
    message: "Claude needs your permission to use Bash",
  });
const pre = (command = "npm test") =>
  ev("PreToolUse", { tool_name: "Bash", tool_input: { command } }, "Bash");

describe("inferPendingPermission", () => {
  it("pairs the permission notification with the PreToolUse just before it", () => {
    // newest first
    const events = [permissionNotif(), pre("rm -rf dist"), ev("PostToolUse", {}, "Read")];
    const got = inferPendingPermission(events);
    expect(got).toMatchObject({
      tool_name: "Bash",
      tool_input: { command: "rm -rf dist" },
      message: "Claude needs your permission to use Bash",
    });
  });

  it("ignores unrelated events between the two (e.g. task snapshots)", () => {
    const events = [permissionNotif(), ev("TaskCreated", { id: "t1" }), pre("ls")];
    expect(inferPendingPermission(events)?.tool_input).toEqual({ command: "ls" });
  });

  it("returns null once the prompt was answered (PostToolUse after it)", () => {
    const events = [ev("PostToolUse", {}, "Bash"), permissionNotif(), pre()];
    expect(inferPendingPermission(events)).toBeNull();
  });

  it("returns null when the user has moved on (UserPromptSubmit / Stop after it)", () => {
    expect(
      inferPendingPermission([ev("UserPromptSubmit", {}), permissionNotif(), pre()])
    ).toBeNull();
    expect(inferPendingPermission([ev("Stop", {}), permissionNotif(), pre()])).toBeNull();
  });

  it("returns null when a newer tool call started (the prompt was allowed)", () => {
    expect(inferPendingPermission([pre("next"), permissionNotif(), pre("first")])).toBeNull();
  });

  it("returns null for a non-permission notification", () => {
    const events = [ev("Notification", { message: "Claude is waiting for your input" }), pre()];
    expect(inferPendingPermission(events)).toBeNull();
  });

  it("returns null when the notification has no PreToolUse behind it", () => {
    expect(inferPendingPermission([permissionNotif(), ev("PostToolUse", {}, "Bash")])).toBeNull();
    expect(inferPendingPermission([permissionNotif()])).toBeNull();
    expect(inferPendingPermission([])).toBeNull();
  });

  it("recognises a permission notification by message when the type is missing", () => {
    const events = [ev("Notification", { message: "Needs permission for Edit" }), pre("x")];
    expect(inferPendingPermission(events)?.tool_name).toBe("Bash");
  });

  it("tolerates unparseable event data", () => {
    const broken = { ...permissionNotif(), data: "{not json" } as DashboardEvent;
    expect(inferPendingPermission([broken, pre()])).toBeNull();
  });
});
