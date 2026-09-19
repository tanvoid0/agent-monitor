/**
 * @file EntityRef.test.tsx
 * @description Tests for the EntityRef chip: href and title per kind, default
 * labels and `chars` truncation, custom children, transient sessions render
 * a plain span with no menu, the context menu lists the translated items per
 * kind, copy items reach the clipboard, reveal folder calls the open-cwd API,
 * `menu={false}` opts out, and right-click does not bubble to an enclosing
 * container.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";
import { EntityRef } from "../EntityRef";
import type { EntityRefProps } from "../EntityRef";

const { openCwd } = vi.hoisted(() => ({ openCwd: vi.fn() }));
vi.mock("../../../lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../../lib/api")>();
  return { ...mod, api: { ...mod.api, sessions: { ...mod.api.sessions, openCwd } } };
});

const writeText = vi.fn(async () => undefined);

function renderRef(props: EntityRefProps, wrap: (node: ReactNode) => ReactNode = (n) => n) {
  return render(<MemoryRouter>{wrap(<EntityRef {...props} />)}</MemoryRouter>);
}

async function openMenu(el: Element) {
  fireEvent.contextMenu(el);
  await screen.findByRole("menu");
  return screen.getAllByRole("menuitem").map((i) => i.textContent);
}

beforeEach(() => {
  writeText.mockClear();
  openCwd.mockReset();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("EntityRef", () => {
  it.each<[EntityRefProps, string, string, string]>([
    [
      { kind: "session", id: "abcdef123456" },
      "/sessions/abcdef123456",
      "Session abcdef12",
      "abcdef123456",
    ],
    [{ kind: "session", id: "abc", name: "Fix login" }, "/sessions/abc", "Fix login", "abc"],
    [
      { kind: "agent", id: "agent-1234567", sessionId: "s1", type: "main" },
      "/sessions/s1?tab=agents#agent-agent-1234567",
      "main",
      "agent-1234567",
    ],
    [
      { kind: "agent", id: "agent-1234567", sessionId: "s1", type: null, name: "Reviewer" },
      "/sessions/s1?tab=agents#agent-agent-1234567",
      "Reviewer",
      "agent-1234567",
    ],
    [
      { kind: "agent", id: "agent-1234567", sessionId: "s1", type: null },
      "/sessions/s1?tab=agents#agent-agent-1234567",
      "agent-12",
      "agent-1234567",
    ],
    [{ kind: "project", cwd: "/w/repo" }, "/sessions?cwd=%2Fw%2Frepo", "repo", "/w/repo"],
    [
      { kind: "project", cwd: "/w/repo/.worktrees/lane" },
      "/sessions?cwd=%2Fw%2Frepo%2F.worktrees%2Flane",
      "repo · .worktrees/lane",
      "/w/repo/.worktrees/lane",
    ],
    [
      { kind: "tool", name: "Bash", sessionId: "s1" },
      "/activity?session_id=s1&tool_name=Bash",
      "Bash",
      "Bash",
    ],
    [
      { kind: "eventType", type: "PreToolUse" },
      "/activity?event_type=PreToolUse",
      "PreToolUse",
      "PreToolUse",
    ],
    [
      { kind: "model", model: "claude-opus-4" },
      "/analytics?tab=cost",
      "claude-opus-4",
      "claude-opus-4",
    ],
    [{ kind: "event", id: 42, sessionId: "s1" }, "/sessions/s1?tab=timeline&event=42", "#42", "42"],
  ])("renders %o as a link with href, label and title", (props, href, label, title) => {
    renderRef(props);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("title", title);
    expect(link.textContent).toBe(label);
    expect(link.className).toContain("font-mono");
  });

  it("chars={0} keeps the full id; mono={false} drops the monospace class", () => {
    renderRef({ kind: "session", id: "abcdef123456", chars: 0, mono: false });
    const link = screen.getByRole("link");
    expect(link.textContent).toBe("Session abcdef123456");
    expect(link.className).not.toContain("font-mono");
  });

  it("renders custom children as the label", () => {
    renderRef({ kind: "model", model: "claude-opus-4-20250514", children: "Opus 4" });
    expect(screen.getByRole("link", { name: "Opus 4" })).toHaveAttribute(
      "title",
      "claude-opus-4-20250514"
    );
  });

  it("transient session is a plain span with no link and no menu", () => {
    renderRef({ kind: "session", id: "proc-1234567", transient: true });
    expect(screen.queryByRole("link")).toBeNull();
    const span = screen.getByTitle("proc-1234567");
    expect(span.tagName).toBe("SPAN");
    expect(span.textContent).toBe("Session proc-123");
    fireEvent.contextMenu(span);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("menu={false} renders the link without a context menu", () => {
    renderRef({ kind: "tool", name: "Bash", menu: false });
    fireEvent.contextMenu(screen.getByRole("link"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("tabbable={false} removes the link from tab order; default keeps it", () => {
    renderRef({ kind: "tool", name: "Bash", tabbable: false });
    expect(screen.getByRole("link")).toHaveAttribute("tabindex", "-1");
    const view = renderRef({ kind: "tool", name: "Grep" });
    expect(within(view.container).getByRole("link")).not.toHaveAttribute("tabindex");
  });

  it("session menu lists the translated items and links", async () => {
    renderRef({ kind: "session", id: "s1", cwd: "/w/repo" });
    expect(await openMenu(screen.getByRole("link"))).toEqual([
      "Open",
      "Open conversation",
      "Open timeline",
      "Show in Activity",
      "Sessions in this project",
      "Show on Board",
      "Resume in Run",
      "Copy session ID",
      "Copy path",
      "Copy link",
      "Reveal folder",
    ]);
    expect(within(screen.getByRole("menu")).getByText("s1")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open timeline" })).toHaveAttribute(
      "href",
      "/sessions/s1?tab=timeline"
    );
  });

  it("agent, project, tool, eventType, model and event menus", async () => {
    const cases: [EntityRefProps, string[]][] = [
      [
        { kind: "agent", id: "a1", sessionId: "s1", type: "worker" },
        [
          "Open conversation",
          "Open events",
          "Open session",
          "Show in Activity",
          "Copy agent ID",
          "Copy session ID",
          "Copy link",
        ],
      ],
      [
        { kind: "project", cwd: "/w/repo", source: "remote" },
        ["Sessions in this project", "Show on Board", "Copy path"],
      ],
      [
        { kind: "tool", name: "Bash", sessionId: "s1" },
        ["Show in Activity", "Filter by this tool", "Copy tool name"],
      ],
      [{ kind: "eventType", type: "Stop" }, ["Show in Activity", "Copy event type"]],
      [{ kind: "model", model: "m" }, ["Cost analytics", "Pricing rules", "Copy model ID"]],
      [
        { kind: "event", id: 7, sessionId: "s1", toolName: "Read", agentId: "a1" },
        [
          "Open timeline",
          "Show in Activity",
          "Filter by this tool",
          "Open agent",
          "Copy event ID",
          "Copy link",
        ],
      ],
    ];
    for (const [props, expected] of cases) {
      const view = renderRef(props);
      expect(await openMenu(screen.getByRole("link"))).toEqual(expected);
      fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      view.unmount();
    }
  });

  it.each<[string, string]>([
    ["claude-opus-4", "claude-pricing"],
    ["gpt-4o", "gpt-pricing"],
    ["o3-mini", "gpt-pricing"],
    ["codex-mini-latest", "gpt-pricing"],
  ])("model %s links Pricing rules to #%s", async (model, section) => {
    renderRef({ kind: "model", model });
    await openMenu(screen.getByRole("link"));
    expect(screen.getByRole("menuitem", { name: "Pricing rules" })).toHaveAttribute(
      "href",
      `/settings#${section}`
    );
  });

  it("copy items write to the clipboard", async () => {
    renderRef({ kind: "agent", id: "a1", sessionId: "s1", type: "main" });
    await openMenu(screen.getByRole("link"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy agent ID" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("a1"));
    await openMenu(screen.getByRole("link"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/sessions/s1?tab=agents#agent-a1`
      )
    );
  });

  it("reveal folder calls api.sessions.openCwd with the cwd", async () => {
    openCwd.mockResolvedValueOnce({ ok: true, cwd: "/w/repo" });
    renderRef({ kind: "project", cwd: "/w/repo" });
    await openMenu(screen.getByRole("link"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reveal folder" }));
    await waitFor(() => expect(openCwd).toHaveBeenCalledWith("/w/repo"));
  });

  it("right-click does not bubble to an enclosing container", () => {
    const outer = vi.fn();
    renderRef({ kind: "tool", name: "Bash" }, (node) => <div onContextMenu={outer}>{node}</div>);
    fireEvent.contextMenu(screen.getByRole("link"));
    expect(outer).not.toHaveBeenCalled();
  });

  it("shift+right-click lets the native menu through instead of opening the kit menu", () => {
    renderRef({ kind: "tool", name: "Bash" });
    fireEvent.contextMenu(screen.getByRole("link"), { shiftKey: true });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
