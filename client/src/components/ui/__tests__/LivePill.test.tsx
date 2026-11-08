/**
 * @file LivePill.test.tsx
 * @description Tests the three-state connection pill (#109): "Connecting..."
 * before the socket has ever connected, "Live" while connected, and "Offline"
 * only after a real drop following a prior connection - never "Offline" on a
 * fresh mount that just hasn't connected yet.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LivePill } from "../LivePill";

describe("LivePill", () => {
  it("shows Connecting, not Offline, on a fresh mount that hasn't connected yet", () => {
    render(<LivePill connected={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Connecting");
    expect(screen.getByRole("status")).not.toHaveTextContent("Offline");
  });

  it("shows Live once connected", () => {
    render(<LivePill connected={true} />);
    expect(screen.getByRole("status")).toHaveTextContent("Live");
  });

  it("shows Offline after a real drop following a prior connection", () => {
    const { rerender } = render(<LivePill connected={true} />);
    rerender(<LivePill connected={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
  });
});
