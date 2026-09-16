/**
 * @file SessionDetail.permissions.test.tsx
 * @description SessionDetail shows *what* a session is blocked on when the
 * permission relay is holding a prompt for it: an inline card with the parsed
 * tool input and the Allow / Allow always / Deny / Answer-in-terminal buttons,
 * wired to the same decision endpoint as the floating relay. Also covers the
 * split between the two surfaces: the floating stack skips the open session's
 * prompts so a prompt is on screen exactly once.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { SessionDetail } from "../SessionDetail";
import { PermissionRelay, openSessionId } from "../../components/PermissionRelay";
import type { Agent, DashboardEvent, PermissionRequest, Session } from "../../lib/types";

const SESSION_ID = "sess-perm";

const session: Session = {
  id: SESSION_ID,
  name: "relay test",
  status: "active",
  cwd: "D:\\projects\\agent-monitor",
  model: "claude-opus-5",
  provider: "claude",
  started_at: "2026-09-16T10:00:00.000Z",
  ended_at: null,
  awaiting_input_since: "2026-09-16T10:00:05.000Z",
  awaiting_reason: "notification",
  metadata: null,
} as Session;

const agent: Agent = {
  id: "agent-1",
  session_id: SESSION_ID,
  name: "Main Agent",
  type: "main",
  subagent_type: null,
  status: "waiting",
  task: null,
  current_tool: null,
  started_at: "2026-09-16T10:00:00.000Z",
  ended_at: null,
  updated_at: "2026-09-16T10:00:05.000Z",
  parent_agent_id: null,
  metadata: null,
};

function prompt(id: string, session_id: string, tool_name = "Bash"): PermissionRequest {
  return {
    id,
    session_id,
    cwd: "D:\\projects\\agent-monitor",
    tool_name,
    tool_input: { command: `echo ${id}`, description: `run ${id}` },
    permission_mode: "default",
    permission_suggestions: [
      {
        type: "addRules",
        behavior: "allow",
        destination: "session",
        rules: [{ toolName: "Bash", ruleContent: "echo" }],
      },
    ],
    received_at: "2026-09-16T10:00:05.000Z",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

let pending: PermissionRequest[] = [];
const decide = vi.fn(() => Promise.resolve({ ok: true }));

vi.mock("../../lib/api", () => ({
  api: {
    sessions: {
      get: vi.fn(() =>
        Promise.resolve({ session, agents: [agent], events: [] as DashboardEvent[] })
      ),
      transcripts: vi.fn(() => Promise.resolve({ transcripts: [] })),
      stats: vi.fn(() =>
        Promise.resolve({
          session_id: SESSION_ID,
          total_events: 0,
          events_by_type: [],
          tools_used: [],
          error_count: 0,
          first_event_at: null,
          last_event_at: null,
          agents: { total: 1, main: 1, subagent: 0, compaction: 0, by_status: {} },
          subagent_types: [],
          tokens: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
        })
      ),
    },
    pricing: { sessionCost: vi.fn(() => Promise.resolve({ total_cost: 0, breakdown: [] })) },
    events: {
      list: vi.fn(() =>
        Promise.resolve({ events: [] as DashboardEvent[], limit: 50, offset: 0, total: 0 })
      ),
      facets: vi.fn(() => Promise.resolve({ event_types: [], tool_names: [] })),
    },
    permissions: {
      list: vi.fn(() => Promise.resolve({ pending, hold_ms: 60_000 })),
      decide: (...args: unknown[]) => decide(...(args as [])),
    },
  },
}));

vi.mock("../../lib/eventBus", () => ({
  eventBus: { subscribe: vi.fn(() => () => {}), onConnection: vi.fn(() => () => {}) },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/sessions/${SESSION_ID}`]}>
      <Routes>
        <Route
          path="/sessions/:id"
          element={
            <>
              <SessionDetail />
              <PermissionRelay />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("openSessionId", () => {
  it("extracts the id from a session detail path only", () => {
    expect(openSessionId("/sessions/abc")).toBe("abc");
    expect(openSessionId("/sessions/abc/")).toBe("abc");
    expect(openSessionId("/sessions/a%20b")).toBe("a b");
    expect(openSessionId("/sessions")).toBeNull();
    expect(openSessionId("/sessions/abc/extra")).toBeNull();
    expect(openSessionId("/kanban")).toBeNull();
  });
});

describe("SessionDetail - pending permission prompt", () => {
  beforeEach(() => {
    decide.mockClear();
  });

  it("shows what the session is waiting on, inline and only once", async () => {
    pending = [prompt("p1", SESSION_ID), prompt("p2", "some-other-session", "Edit")];
    renderPage();

    // The page-level region lists this session's prompt with its parsed input.
    const regions = await screen.findAllByRole("region", { name: /permission requests/i });
    // Exactly two regions: the inline banner and the floating stack.
    expect(regions).toHaveLength(2);

    const inline = regions.find((r) => within(r).queryByText("echo p1"))!;
    expect(inline).toBeTruthy();
    expect(within(inline).getByText(/wants to run Bash/i)).toBeInTheDocument();
    expect(within(inline).getByText("run p1")).toBeInTheDocument();
    // The page already says which session this is — no project · session line.
    expect(within(inline).queryByText(/agent-monitor · sess-per/)).toBeNull();

    // The floating stack carries only the *other* session's prompt.
    const floating = regions.find((r) => r !== inline)!;
    expect(within(floating).getByText(/wants to run Edit/i)).toBeInTheDocument();
    expect(within(floating).queryByText("echo p1")).toBeNull();
  });

  it("posts the decision taken from the session page", async () => {
    pending = [prompt("p1", SESSION_ID)];
    renderPage();
    const regions = await screen.findAllByRole("region", { name: /permission requests/i });
    const inline = regions.find((r) => within(r).queryByText("echo p1"))!;

    fireEvent.click(within(inline).getByRole("button", { name: /^Allow$/ }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("p1", {
        behavior: "allow",
        updatedPermissions: undefined,
      })
    );

    fireEvent.click(within(inline).getByRole("button", { name: /allow always/i }));
    await waitFor(() =>
      expect(decide).toHaveBeenLastCalledWith("p1", {
        behavior: "allow",
        updatedPermissions: [expect.objectContaining({ type: "addRules", behavior: "allow" })],
      })
    );

    fireEvent.click(within(inline).getByRole("button", { name: /answer in terminal/i }));
    await waitFor(() =>
      expect(decide).toHaveBeenLastCalledWith("p1", {
        behavior: "defer",
        updatedPermissions: undefined,
      })
    );
  });

  it("renders no permission region when nothing is pending for this session", async () => {
    pending = [prompt("p2", "some-other-session")];
    renderPage();
    // Only the floating stack (for the other session) exists.
    const regions = await screen.findAllByRole("region", { name: /permission requests/i });
    expect(regions).toHaveLength(1);
    expect(within(regions[0]!).queryByText(/wants to run/i)).toBeInTheDocument();
    // But the generic "why" callout still explains the wait.
    expect(screen.getByText(/waiting for your input/i)).toBeInTheDocument();
  });
});
