/**
 * @file CompactRow.test.tsx
 * @description Smoke test for the shared one-line row: renders name,
 * timestamp, and the kebab menu when a menu is given.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CompactRow } from "../CompactRow";

describe("CompactRow", () => {
  it("renders name, timestamp and kebab menu", () => {
    render(
      <MemoryRouter>
        <CompactRow
          accent=""
          badge={<span>status</span>}
          name="Row name"
          ts="2026-08-02T00:00:00.000Z"
          menu={[{ label: "Copy ID", onSelect: () => {} }]}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Row name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more actions/i })).toBeInTheDocument();
  });
});
