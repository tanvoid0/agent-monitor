/**
 * @file SessionRow.test.tsx
 * @description Tests for the Sessions table row: the EntityRef session link,
 * agent-count deep link, remote-source and Run badges, the trailing kebab
 * carrying the session's entity menu, and the transient Codex startup row
 * rendering without links or a menu.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SessionRow, SESSION_ROW_COLUMNS } from "../SessionRow";
import type { Session } from "../../lib/types";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "019fbe8f-b608-7c80-afec-ee65e2ebbe1c",
    name: "Ship real-time session discovery",
    status: "completed",
    cwd: "/Users/dev/project",
    model: "claude-opus-5",
    started_at: "2026-08-02T00:00:00.000Z",
    ended_at: "2026-08-02T00:05:00.000Z",
    metadata: null,
    agent_count: 3,
    cost: 1.25,
    provider: "claude",
    source: "local",
    ...overrides,
  };
}

function renderRow(props: Partial<Parameters<typeof SessionRow>[0]> = {}) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <SessionRow session={makeSession()} {...props} />
        </tbody>
      </table>
    </MemoryRouter>
  );
}

describe("SessionRow", () => {
  it("renders every table column with the session link, agents deep link and kebab", () => {
    renderRow();
    const row = screen.getByRole("row");
    expect(within(row).getAllByRole("cell")).toHaveLength(SESSION_ROW_COLUMNS);

    expect(screen.getByRole("link", { name: "Ship real-time session discovery" })).toHaveAttribute(
      "href",
      "/sessions/019fbe8f-b608-7c80-afec-ee65e2ebbe1c"
    );
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute(
      "href",
      "/sessions/019fbe8f-b608-7c80-afec-ee65e2ebbe1c?tab=agents"
    );
    expect(screen.getByText("$1.25")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More actions for Ship real-time session discovery" })
    ).toBeInTheDocument();
  });

  it("shows the remote-source label and the Run badge when asked", () => {
    renderRow({
      session: makeSession({ source: "build-box" }),
      sourceLabel: "Build box",
      isDashboardRun: true,
    });
    expect(screen.getByText("Build box")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run" })).toHaveAttribute(
      "href",
      "/run?session=019fbe8f-b608-7c80-afec-ee65e2ebbe1c"
    );
  });

  it("renders a transient Codex startup row without links or a menu", () => {
    renderRow({
      session: makeSession({
        name: "codex",
        ended_at: null,
        cost: undefined,
        metadata: JSON.stringify({ pre_identity_process: true }),
      }),
    });
    // The name is plain text and the model chip is gone; only the project chip
    // still links, because the project is real even before the id is durable.
    expect(screen.queryByRole("link", { name: "codex" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/sessions?cwd=%2FUsers%2Fdev%2Fproject"
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});
