/**
 * @file atoms.test.tsx
 * @description Render smoke tests for the kit's small standalone atoms:
 * PageHeader, SectionHeader, LivePill, Badge — each renders without throwing
 * and shows its given text.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Home } from "lucide-react";
import { PageHeader } from "../PageHeader";
import { SectionHeader } from "../SectionHeader";
import { LivePill } from "../LivePill";
import { Badge } from "../Badge";

describe("PageHeader", () => {
  it("renders the title", () => {
    render(
      <MemoryRouter>
        <PageHeader icon={Home} title="Dashboard" />
      </MemoryRouter>
    );
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });
});

describe("SectionHeader", () => {
  it("renders the title and count", () => {
    render(<SectionHeader title="Sessions" count={3} />);
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("LivePill", () => {
  it("renders a status role", () => {
    render(<LivePill connected />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toBeInTheDocument();
  });
});
