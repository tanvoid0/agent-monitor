/**
 * @file ContextMenu.test.tsx
 * @description Tests for ContextMenuFor (right-click opens role=menu, items
 * and separators/labels render, `to` items are links, onSelect fires, Escape
 * closes without leaking to an enclosing window listener, a nested touch
 * trigger opens exactly one menu, Enter on a link item navigates) and
 * MenuButton (kebab opens a dropdown menu).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { ContextMenuFor } from "../ContextMenu";
import { Clickable } from "../Clickable";
import { MenuButton } from "../DropdownMenu";
import type { MenuItem } from "../Menu";

const onCopy = vi.fn();
const items: MenuItem[] = [
  { type: "label", label: "abc-123" },
  { label: "Open", to: "/sessions/abc-123" },
  { type: "separator" },
  { label: "Copy ID", onSelect: onCopy },
  { label: "Delete", danger: true, disabled: true },
];

describe("ContextMenuFor", () => {
  it("opens a menu on contextmenu with links, actions, label and separator", async () => {
    render(
      <MemoryRouter>
        <ContextMenuFor items={items}>
          <div data-testid="row">row</div>
        </ContextMenuFor>
      </MemoryRouter>
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByTestId("row"));
    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getByText("abc-123")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    const link = screen.getByRole("menuitem", { name: "Open" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/sessions/abc-123");
    const del = screen.getByRole("menuitem", { name: "Delete" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(del.className).toContain("text-red-300");
  });

  it("fires onSelect and closes on Escape", async () => {
    render(
      <MemoryRouter>
        <ContextMenuFor items={items}>
          <div data-testid="row">row</div>
        </ContextMenuFor>
      </MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByTestId("row"));
    const copy = await screen.findByRole("menuitem", { name: "Copy ID" });
    fireEvent.click(copy);
    // onSelect is deferred past Radix's FocusScope trap (see Menu.tsx).
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.contextMenu(screen.getByTestId("row"));
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("lets the native menu through when disabled", () => {
    render(
      <MemoryRouter>
        <ContextMenuFor items={items} disabled>
          <div data-testid="row">row</div>
        </ContextMenuFor>
      </MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape does not leak to an enclosing window keydown listener", async () => {
    render(
      <MemoryRouter>
        <ContextMenuFor items={items}>
          <div data-testid="row">row</div>
        </ContextMenuFor>
      </MemoryRouter>
    );
    const win = vi.fn();
    window.addEventListener("keydown", win);
    try {
      fireEvent.contextMenu(screen.getByTestId("row"));
      const menu = await screen.findByRole("menu");
      fireEvent.keyDown(menu, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(win).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", win);
    }
  });

  it("does not open a menu on contextmenu with an active text selection (Clickable)", () => {
    render(
      <MemoryRouter>
        <Clickable to="/x" data-testid="row" menu={items}>
          <span data-testid="text">row text</span>
        </Clickable>
      </MemoryRouter>
    );
    const text = screen.getByTestId("text");
    const range = document.createRange();
    range.selectNodeContents(text);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.contextMenu(text);
    expect(screen.queryByRole("menu")).toBeNull();
    sel.removeAllRanges();
  });

  it("a disabled `to` item does not navigate on click", async () => {
    function Location() {
      return <span data-testid="loc">{useLocation().pathname}</span>;
    }
    const disabledLinkItems: MenuItem[] = [
      { label: "Open", to: "/sessions/abc-123", disabled: true },
    ];
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Location />
        <ContextMenuFor items={disabledLinkItems}>
          <div data-testid="row">row</div>
        </ContextMenuFor>
      </MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByTestId("row"));
    const link = await screen.findByRole("menuitem", { name: "Open" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabIndex", "-1");
    fireEvent.click(link);
    expect(screen.getByTestId("loc").textContent).toBe("/start");
  });

  it("Enter on a `to` menu item navigates and closes the menu", async () => {
    function Location() {
      return <span data-testid="loc">{useLocation().pathname}</span>;
    }
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Location />
        <ContextMenuFor items={items}>
          <div data-testid="row">row</div>
        </ContextMenuFor>
      </MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByTestId("row"));
    const link = await screen.findByRole("menuitem", { name: "Open" });
    link.focus();
    fireEvent.keyDown(link, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/sessions/abc-123"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});

describe("nested ContextMenuFor (EntityRef-in-Clickable long-press)", () => {
  it("a touch long-press on the inner trigger opens exactly one menu", async () => {
    render(
      <MemoryRouter>
        <ContextMenuFor items={items}>
          <div data-testid="outer">
            <ContextMenuFor items={items}>
              <a data-testid="inner" href="#inner">
                inner
              </a>
            </ContextMenuFor>
          </div>
        </ContextMenuFor>
      </MemoryRouter>
    );
    fireEvent.pointerDown(screen.getByTestId("inner"), { pointerType: "touch" });
    await new Promise((r) => setTimeout(r, 800));
    await waitFor(() => expect(screen.queryAllByRole("menu")).toHaveLength(1));
  });
});

describe("MenuButton", () => {
  it("renders a kebab trigger that opens a dropdown menu", async () => {
    render(
      <MemoryRouter>
        <MenuButton items={items} label="Row actions" size="xs" />
      </MemoryRouter>
    );
    const kebab = screen.getByRole("button", { name: "Row actions" });
    expect(kebab).toHaveAttribute("aria-haspopup", "menu");
    expect(kebab).toHaveAttribute("aria-expanded", "false");
    expect(kebab).toHaveAttribute("title", "Row actions");
    await userEvent.click(kebab);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(kebab).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveAttribute(
      "href",
      "/sessions/abc-123"
    );
  });

  it("falls back to the translated openMenu label", () => {
    render(
      <MemoryRouter>
        <MenuButton items={items} />
      </MemoryRouter>
    );
    const kebab = screen.getByRole("button");
    expect(kebab.getAttribute("aria-label")).toBeTruthy();
    expect(kebab).toHaveAttribute("aria-haspopup", "menu");
  });
});
