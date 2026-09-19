/**
 * @file Plan.tick.test.tsx
 * @description P4 — the board checkbox flips optimistically on click, then
 * reverts (and surfaces an error banner) when `POST tick` rejects, as it
 * would on a 4xx.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
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

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([{ slug: "ledgerflow", cwd: "x", step: 17 }]);
  modelMock.mockReset().mockResolvedValue(modelFixture);
  tickMock.mockReset();
  localStorage.clear();
});

describe("Plan board — tick", () => {
  it("flips the checkbox immediately, then reverts and shows an error on a 4xx", async () => {
    tickMock.mockRejectedValue(new Error("unknown key"));

    render(
      <MemoryRouter initialEntries={["/plan/ledgerflow"]}>
        <Routes>
          <Route path="/plan/:slug?" element={<Plan />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();

    // D4 is unticked ("todo") in the fixture.
    const key = screen.getByText("D4");
    const card = key.closest(".card-hover") as HTMLElement;
    const checkbox = within(card).getByRole("checkbox");
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    fireEvent.click(checkbox);
    // Optimistic flip happens synchronously with the click.
    expect(checkbox).toHaveAttribute("aria-checked", "true");

    await settle();

    expect(tickMock).toHaveBeenCalledWith("ledgerflow", "D4", true);
    // Reverted after the rejected POST.
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Couldn't update the checkbox/)).toBeInTheDocument();
  });

  it("keeps the flip and re-pulls the model on success", async () => {
    tickMock.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter initialEntries={["/plan/ledgerflow"]}>
        <Routes>
          <Route path="/plan/:slug?" element={<Plan />} />
        </Routes>
      </MemoryRouter>
    );
    await settle();
    expect(modelMock).toHaveBeenCalledTimes(1);

    const key = screen.getByText("D4");
    const card = key.closest(".card-hover") as HTMLElement;
    fireEvent.click(within(card).getByRole("checkbox"));
    await settle();

    expect(tickMock).toHaveBeenCalledWith("ledgerflow", "D4", true);
    expect(modelMock).toHaveBeenCalledTimes(2); // authoritative re-pull after a successful tick
  });
});
