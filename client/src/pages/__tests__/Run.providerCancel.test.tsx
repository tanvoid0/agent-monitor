/**
 * @file Run.providerCancel.test.tsx
 * @description Cancel on the provider-chooser dialog must close the dialog in
 * place, not navigate away (#103) — there's nothing else to show without a
 * provider, so it used to look like the only way to dismiss the dialog was
 * leaving the page entirely.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const r = (value: unknown) => vi.fn().mockResolvedValue(value);
  return {
    ...actual,
    api: {
      run: {
        list: r({ runs: [], items: [] }),
        history: r({ items: [] }),
        binary: r({ found: true, path: "/usr/bin/claude" }),
        models: r({ provider: "claude", dynamic: false, source: "aliases", items: [] }),
        cwds: r({ items: [] }),
        files: r({ items: [] }),
      },
      ccConfig: {
        commands: r({ items: [] }),
        plugins: r({ plugins: [] }),
        file: r({ content: "" }),
      },
      sessions: { list: r({ sessions: [], total: 0, limit: 50, offset: 0 }) },
    },
  };
});

vi.mock("../../lib/eventBus", () => ({
  eventBus: {
    subscribe: () => () => {},
    publish: () => {},
    onConnection: () => () => {},
    connected: true,
    setConnected: () => {},
  },
}));

import { Run } from "../Run";

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver || (ObserverStub as unknown as typeof ResizeObserver);

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Run page — provider chooser Cancel (#103)", () => {
  it("closes the dialog in place and offers a way back in, without navigating", async () => {
    render(
      <MemoryRouter initialEntries={["/run"]}>
        <Run />
      </MemoryRouter>
    );
    await settle();

    const dialog = screen.getByRole("dialog");
    await act(async () => {
      within(dialog)
        .getByRole("button", { name: /cancel/i })
        .click();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("No agent selected")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: /choose/i }).click();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
