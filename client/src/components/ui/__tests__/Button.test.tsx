/**
 * @file Button.test.tsx
 * @description Tests for the kit Button and IconButton: variant/size classes,
 * `to` rendering a react-router link with the same classes, loading state,
 * and IconButton's required accessible name.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Trash2 } from "lucide-react";
import { Button, buttonVariants } from "../Button";
import { IconButton } from "../IconButton";

describe("Button", () => {
  it("applies variant and size classes and merges className", () => {
    render(
      <Button variant="danger" size="xs" className="px-9">
        Delete
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn.className).toContain("text-red-300");
    expect(btn.className).toContain("text-xs");
    // caller className wins over the size padding
    expect(btn.className).toContain("px-9");
    expect(btn.className).not.toContain("px-2 ");
  });

  it("defaults to secondary/md", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button").className).toBe(buttonVariants());
  });

  it("renders a react-router link with identical classes when `to` is given", () => {
    render(
      <MemoryRouter>
        <Button variant="primary" to="/sessions/abc" icon={Trash2}>
          Open
        </Button>
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("href", "/sessions/abc");
    expect(link.className).toContain(buttonVariants({ variant: "primary" }));
    expect(link.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks the control busy and disabled while loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn.querySelector(".animate-spin")).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("exposes label as aria-label and title and keeps the 24px floor", () => {
    render(<IconButton icon={Trash2} label="Remove" size="xs" />);
    const btn = screen.getByRole("button", { name: "Remove" });
    expect(btn).toHaveAttribute("title", "Remove");
    expect(btn.className).toContain("w-6 h-6");
    expect(btn.className).toContain("p-0");
    expect(btn.className).not.toMatch(/\bpx-2\b/);
  });

  it("renders as a link when `to` is given", () => {
    render(
      <MemoryRouter>
        <IconButton icon={Trash2} label="Back" to="/sessions" />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/sessions");
  });
});
