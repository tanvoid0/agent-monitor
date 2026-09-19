/**
 * @file Plan.ws.test.tsx
 * @description P3 — the page subscribes to the shared WebSocket pipeline
 * (`eventBus`, the same one `useWebSocket` publishes to in App.tsx) for
 * `plan_model` (applied directly), `plan_updated`, and `plan_log` (both
 * re-pull the model — see the ponytail note in Plan.tsx for why).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { eventBus } from "../../lib/eventBus";
import type { WSMessage } from "../../lib/types";
// client/ has no @types/node — see Plan.render.test.tsx for why this is a
// plain JSON import rather than node:fs.
import modelFixture from "../../../../test/fixtures/plan/ledgerflow/expected/model.json";

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

function publish(type: string, data: unknown) {
  return eventBus.publish({
    type,
    data,
    timestamp: new Date().toISOString(),
  } as unknown as WSMessage);
}

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([{ slug: "ledgerflow", cwd: "x", step: 17 }]);
  modelMock.mockReset().mockResolvedValue(modelFixture);
  tickMock.mockReset().mockResolvedValue({ ok: true });
  localStorage.clear();
});

describe("Plan page — WebSocket subscription", () => {
  it("plan_model for this slug replaces the model without an extra fetch", async () => {
    render(
      <MemoryRouter initialEntries={["/plan/ledgerflow"]}>
        <Routes>
          <Route path="/plan/:slug?" element={<Plan />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    expect(modelMock).toHaveBeenCalledTimes(1);

    const pushed = {
      ...modelFixture,
      status: { ...modelFixture.status, text: "pushed over the wire" },
    };
    await act(async () => {
      publish("plan_model", { slug: "ledgerflow", model: pushed });
    });

    expect(screen.getByText("pushed over the wire")).toBeInTheDocument();
    expect(modelMock).toHaveBeenCalledTimes(1);
  });

  it("plan_updated and plan_log for this slug re-pull the model", async () => {
    render(
      <MemoryRouter initialEntries={["/plan/ledgerflow"]}>
        <Routes>
          <Route path="/plan/:slug?" element={<Plan />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    expect(modelMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      publish("plan_updated", { slug: "ledgerflow" });
    });
    await settle();
    expect(modelMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      publish("plan_log", { slug: "ledgerflow", row: { key: "D4", status: "start" } });
    });
    await settle();
    expect(modelMock).toHaveBeenCalledTimes(3);
  });

  it("ignores messages for a different plan's slug", async () => {
    render(
      <MemoryRouter initialEntries={["/plan/ledgerflow"]}>
        <Routes>
          <Route path="/plan/:slug?" element={<Plan />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    expect(modelMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      publish("plan_updated", { slug: "some-other-project" });
    });
    await settle();
    expect(modelMock).toHaveBeenCalledTimes(1);
  });
});
