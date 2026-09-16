/**
 * @file Permissions.test.tsx
 * @description The dedicated /permissions page: empty state with the hold
 * window, one card per pending prompt beside its session context (name,
 * last prompt, recent tool calls, timeline link), a no-context fallback for
 * prompts without a session id, and decisions posting through the shared
 * relay hook.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Permissions } from "../Permissions";
import type { DashboardEvent, PermissionRequest, Session } from "../../lib/types";

let pending: PermissionRequest[] = [];
const decide = vi.fn(() => Promise.resolve({ ok: true }));
const getSession = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    permissions: {
      list: vi.fn(() => Promise.resolve({ pending, hold_ms: 45_000 })),
      decide: (...args: unknown[]) => decide(...(args as [])),
    },
    sessions: { get: (...args: unknown[]) => getSession(...(args as [])) },
  },
}));

vi.mock("../../lib/eventBus", () => ({
  eventBus: {
    subscribe: vi.fn(() => () => {}),
    onConnection: vi.fn(() => () => {}),
    connected: true,
  },
}));

function prompt(id: string, session_id: string | null): PermissionRequest {
  return {
    id,
    session_id,
    cwd: "D:\\p\\agent-monitor",
    tool_name: "Bash",
    tool_input: { command: `echo ${id}` },
    permission_mode: "default",
    permission_suggestions: [],
    received_at: "2026-09-16T10:00:00.000Z",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

const session: Session = {
  id: "sess-1",
  name: "Fix the build",
  status: "active",
  cwd: "D:\\p\\agent-monitor",
  model: "claude-opus-5",
  provider: "claude",
  started_at: "2026-09-16T10:00:00.000Z",
  ended_at: null,
  awaiting_input_since: "2026-09-16T10:00:05.000Z",
  awaiting_reason: "notification",
  prompt_preview: "please fix the failing build",
  metadata: null,
} as Session;

const toolEvent = (id: number, tool: string, type = "PreToolUse"): DashboardEvent =>
  ({
    id,
    session_id: "sess-1",
    agent_id: null,
    event_type: type,
    tool_name: tool,
    data: JSON.stringify({ tool_name: tool, tool_input: { command: "npm test" } }),
    created_at: "2026-09-16T10:00:0" + (id % 10) + ".000Z",
    status: null,
  }) as unknown as DashboardEvent;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/permissions"]}>
      <Permissions />
    </MemoryRouter>
  );
}

describe("Permissions page", () => {
  beforeEach(() => {
    decide.mockClear();
    getSession.mockReset();
    getSession.mockImplementation(() =>
      Promise.resolve({
        session,
        agents: [],
        workflows: [],
        events: [
          toolEvent(9, "Bash"),
          toolEvent(8, "Read", "PostToolUse"),
          toolEvent(7, "Edit"),
          { ...toolEvent(6, "x"), event_type: "Notification", tool_name: null },
        ],
      })
    );
  });

  it("shows the empty state with the relay's hold window", async () => {
    pending = [];
    renderPage();
    expect(await screen.findByText(/no pending permission prompts/i)).toBeInTheDocument();
    expect(await screen.findByText(/up to 45 s/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /permission requests/i })).toBeNull();
  });

  it("lists each prompt beside its session context and fetches each session once", async () => {
    pending = [prompt("p1", "sess-1"), prompt("p2", "sess-1")];
    renderPage();
    const region = await screen.findByRole("region", { name: /permission requests/i });
    expect(within(region).getAllByText(/wants to run Bash/i)).toHaveLength(2);
    expect(within(region).getByText("echo p1")).toBeInTheDocument();
    expect(within(region).getByText("echo p2")).toBeInTheDocument();

    // Session context, once loaded.
    expect(await within(region).findAllByText("Fix the build")).toHaveLength(2);
    expect(within(region).getAllByText("please fix the failing build")).toHaveLength(2);
    // Only tool events make the recent list — the Notification is skipped.
    const links = within(region).getAllByRole("link", { name: /open session timeline/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/sessions/sess-1?tab=timeline");

    await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    expect(getSession).toHaveBeenCalledWith("sess-1");
  });

  it("explains a prompt that carried no session id", async () => {
    pending = [prompt("p3", null)];
    renderPage();
    expect(await screen.findByText(/did not carry a session id/i)).toBeInTheDocument();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("explains a session the dashboard has no record of", async () => {
    getSession.mockImplementation(() => Promise.reject(new Error("404")));
    pending = [prompt("p4", "ghost")];
    renderPage();
    expect(await screen.findByText(/no record of this session/i)).toBeInTheDocument();
  });

  it("posts a decision from the page", async () => {
    pending = [prompt("p1", "sess-1")];
    renderPage();
    const region = await screen.findByRole("region", { name: /permission requests/i });
    fireEvent.click(within(region).getByRole("button", { name: /^Deny$/ }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("p1", { behavior: "deny", updatedPermissions: undefined })
    );
  });
});
