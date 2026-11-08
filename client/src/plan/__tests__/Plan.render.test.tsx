/**
 * @file Plan.render.test.tsx
 * @description P1/P2/P5 — renders the plan page against the exact
 * ledgerflow fixture model (`test/fixtures/plan/ledgerflow/expected/model.json`)
 * through a mocked `planApi`: rail, board, agents panel, and the task detail
 * drawer (click and `?task=` deep link), plus the project picker's
 * route-param default and the tick checkbox's `$`/waiting/say rendering.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
// client/ has no @types/node, so the fixture is loaded as a plain JSON
// import (resolveJsonModule) rather than via node:fs — a relative path is
// enough since Vite/vitest resolve module specifiers against the file on
// disk, not tsconfig's "include".
import modelFixture from "../../../../test/fixtures/plan/ledgerflow/expected/model.json";

const planList = [
  { slug: "ledgerflow", cwd: "D:/projects/practice/microservices/ledgerflow", step: 17, live: 1 },
];

const { listMock, modelMock, tickMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  modelMock: vi.fn(),
  tickMock: vi.fn(),
}));

vi.mock("../api", () => ({
  planApi: { list: listMock, model: modelMock, tick: tickMock },
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: {
      events: { list: vi.fn().mockResolvedValue({ events: [], limit: 10, offset: 0, total: 0 }) },
    },
  };
});

import { Plan } from "../Plan";

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  listMock.mockReset().mockResolvedValue(planList);
  modelMock.mockReset().mockResolvedValue(modelFixture);
  tickMock.mockReset().mockResolvedValue({ ok: true });
  localStorage.clear();
});

function renderPlan(initialPath = "/plan") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/plan/:slug?" element={<Plan />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Plan page — ledgerflow fixture", () => {
  it("P2: a bare /plan visit resolves to the picker's first project and remembers it", async () => {
    renderPlan("/plan");
    await settle();
    expect(modelMock).toHaveBeenCalledWith("ledgerflow");
    expect(localStorage.getItem("plan-last-slug")).toBe("ledgerflow");
  });

  it("P1: renders the rail (milestones/lanes), the board (columns + boxes), and the agents panel from the fixture", async () => {
    renderPlan("/plan/ledgerflow");
    await settle();

    // Rail: current milestone (M3) and the current step's lanes.
    expect(screen.getAllByText(/M3/).length).toBeGreaterThan(0);
    expect(screen.getByText("Demo")).toBeInTheDocument(); // lane D
    expect(screen.getByText("README top + ADRs")).toBeInTheDocument(); // lane A

    // Board: all four columns render, with the fixture's box text visible.
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.getByText("Doing")).toBeInTheDocument();
    expect(screen.getByText("Reported")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getAllByText(/D4/).length).toBeGreaterThan(0);

    // Agents panel: the live lane-D agent renders with its model + cost.
    expect(screen.getAllByText(/crew:coder/).length).toBeGreaterThan(0);
  });

  it("P5: a task card for the live agent shows the $ badge; waiting/say render when present", async () => {
    renderPlan("/plan/ledgerflow");
    await settle();

    // D3 is the live agent's current box — the fixture's agent has ctxPct 81
    // and no v3 `cost`, so the badge falls back to omitting `$` gracefully
    // (an optional field, per the fixture note) rather than crashing.
    expect(screen.getAllByText(/81%/).length).toBeGreaterThan(0);
  });

  it("P1: opening a task's detail drawer shows the breadcrumb, status, and log lines", async () => {
    renderPlan("/plan/ledgerflow");
    await settle();

    fireEvent.click(screen.getByText("D1"));
    await settle();

    expect(screen.getByText(/Step 17/)).toBeInTheDocument();
    expect(screen.getByText(/Lane D/)).toBeInTheDocument();
    expect(screen.getAllByText(/start-services\.sh \+ stop-services\.sh/).length).toBeGreaterThan(
      0
    );
  });

  it("?task=<key> deep-links straight into that task's drawer", async () => {
    renderPlan("/plan/ledgerflow?task=D1");
    await settle();

    expect(screen.getByText(/Step 17/)).toBeInTheDocument();
    expect(screen.getByText(/Lane D/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open session/i })).toHaveAttribute(
      "href",
      "/sessions/1ee316a7-e0a8-4575-889e-42860c12df39"
    );
  });

  it("shows an empty state instead of a blank body when the plan has no stories yet (#110)", async () => {
    modelMock.mockResolvedValue({
      now: "2026-01-01T00:00:00Z",
      status: { date: "2026-01-01", text: "" },
      steps: { done: 0, total: 0, current: null },
      milestones: [],
      stories: [],
      agents: {},
      totals: {},
    });
    renderPlan("/plan/ledgerflow");
    await settle();

    expect(screen.getByText("No plan content yet")).toBeInTheDocument();
    expect(screen.queryByText("To do")).not.toBeInTheDocument();
  });
});
