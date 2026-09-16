/**
 * @file Clickable.test.tsx
 * @description Tests for the Clickable container: surface click navigates or
 * activates, clicks on inner controls are ignored, ctrl/meta/middle click
 * opens a new tab, the kebab and `data-menu` render when a menu is given,
 * right-click opens the menu, and shift+right-click passes through.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Clickable } from "../Clickable";
import type { MenuItem } from "../Menu";

const navigate = vi.fn();
vi.mock("react-router", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router")>();
  return { ...mod, useNavigate: () => navigate };
});

const menu: MenuItem[] = [{ label: "Open", to: "/sessions/s1" }, { label: "Copy" }];

function renderRow(props: Partial<React.ComponentProps<typeof Clickable>> = {}) {
  return render(
    <MemoryRouter>
      <Clickable to="/sessions/s1" data-testid="row" {...props}>
        <span>Session one</span>
        <a href="/x" data-testid="inner-link" onClick={(e) => e.preventDefault()}>
          inner
        </a>
        <button type="button" data-testid="inner-btn">
          expand
        </button>
      </Clickable>
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigate.mockReset();
});

describe("Clickable", () => {
  it("navigates on a plain surface click and has no role or tabIndex", () => {
    renderRow();
    const row = screen.getByTestId("row");
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
    expect(row.className).toContain("cursor-pointer");
    fireEvent.click(screen.getByText("Session one"));
    expect(navigate).toHaveBeenCalledWith("/sessions/s1");
  });

  it("ignores clicks on inner controls", () => {
    renderRow();
    fireEvent.click(screen.getByTestId("inner-btn"));
    fireEvent.click(screen.getByTestId("inner-link"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens a new tab on ctrl/meta/middle click", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderRow();
    const text = screen.getByText("Session one");
    fireEvent.click(text, { ctrlKey: true });
    fireEvent.click(text, { metaKey: true });
    fireEvent(text, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(open).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenLastCalledWith("/sessions/s1", "_blank", "noopener");
    expect(navigate).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("does not navigate on a right-button auxclick", () => {
    renderRow();
    fireEvent(
      screen.getByText("Session one"),
      new MouseEvent("auxclick", { bubbles: true, button: 2 })
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("calls onActivate when there is no `to`", () => {
    const onActivate = vi.fn();
    renderRow({ to: undefined, onActivate });
    fireEvent.click(screen.getByText("Session one"));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("renders data-menu, a kebab in the tab order, and opens the menu on right-click", async () => {
    renderRow({ menu });
    const row = screen.getByTestId("row");
    expect(row).toHaveAttribute("data-menu", "");
    expect(row.className).toContain("group");
    const kebab = row.querySelector('button[aria-haspopup="menu"]') as HTMLElement;
    expect(kebab).not.toBeNull();
    expect(kebab).toBe(row.lastElementChild);
    expect(kebab.tabIndex).toBe(0);
    expect(kebab.className).toContain("group-hover:opacity-100");

    fireEvent.contextMenu(screen.getByText("Session one"));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveAttribute("href", "/sessions/s1");
    // a click inside the portalled menu must not trigger the row navigation
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("omits the kebab with kebab={false} and passes shift+right-click through", () => {
    renderRow({ menu, kebab: false });
    const row = screen.getByTestId("row");
    expect(row.querySelector('button[aria-haspopup="menu"]')).toBeNull();
    fireEvent.contextMenu(screen.getByText("Session one"), { shiftKey: true });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("ignores a click that ends a drag-selection inside the row", () => {
    renderRow();
    const text = screen.getByText("Session one");
    const range = document.createRange();
    range.selectNodeContents(text);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.click(text);
    expect(navigate).not.toHaveBeenCalled();
    sel.removeAllRanges();
  });

  it('renders no kebab by default for as="tr" with a menu (button-in-tr is invalid DOM)', () => {
    render(
      <MemoryRouter>
        <table>
          <tbody>
            <Clickable as="tr" to="/sessions/s1" menu={menu} data-testid="tr">
              <td>cell</td>
            </Clickable>
          </tbody>
        </table>
      </MemoryRouter>
    );
    const tr = screen.getByTestId("tr");
    expect(tr.querySelector('button[aria-haspopup="menu"]')).toBeNull();
  });

  it("renders as the requested element", () => {
    render(
      <MemoryRouter>
        <table>
          <tbody>
            <Clickable as="tr" to="/sessions/s1" data-testid="tr">
              <td>cell</td>
            </Clickable>
          </tbody>
        </table>
      </MemoryRouter>
    );
    expect(screen.getByTestId("tr").tagName).toBe("TR");
  });
});
