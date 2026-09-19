/**
 * @file EventRow.test.tsx
 * @description Unit test for the shared EventRow: the expander button reports
 * `isOpen` via aria-expanded and routes both the button click and the
 * whole-row click through `onToggle`. Renders inside a MemoryRouter because
 * the tool chip is an EntityRef link.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { EventRow } from "../EventRow";
import type { DashboardEvent } from "../../lib/types";

const event: DashboardEvent = {
  id: 7,
  session_id: "sess-1",
  agent_id: "agent-1",
  event_type: "PreToolUse",
  tool_name: "Bash",
  summary: "Using tool: Bash",
  data: null,
  created_at: new Date().toISOString(),
};

function renderRow(isOpen: boolean, onToggle = vi.fn()) {
  render(
    <MemoryRouter>
      <EventRow
        event={event}
        sessionId="sess-1"
        isOpen={isOpen}
        onToggle={onToggle}
        id="event-7"
        time={<span>now</span>}
      />
    </MemoryRouter>
  );
  return onToggle;
}

describe("EventRow", () => {
  it("reflects isOpen on the expander and toggles via onToggle", () => {
    const onToggle = renderRow(false);
    const expander = screen.getByRole("button", { name: "Expand event" });
    expect(expander).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expander);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // Whole-row click (outside inner controls) also toggles through Clickable.
    fireEvent.click(screen.getByText("now"));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("labels the expander as collapse when open", () => {
    renderRow(true);
    expect(screen.getByRole("button", { name: "Collapse event" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
});
