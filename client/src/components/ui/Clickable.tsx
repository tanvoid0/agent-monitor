/**
 * @file Clickable.tsx
 * @description Row/card container with mouse conveniences: whole-surface click
 * navigates (`to`) or activates (`onActivate`), ctrl/meta/middle click opens
 * `to` in a new tab, right-click / long-press opens `menu`, and a hover-
 * revealed kebab exposes the same items to keyboard and touch users. The
 * container itself carries NO role or tabIndex — exactly one primary control
 * (a link for `to`, a button for `onActivate`) must live inside as the
 * keyboard target. Clicks on inner controls are ignored so they need no
 * stopPropagation; shift+right-click or an active text selection lets the
 * native context menu through (shared with EntityRef via ContextMenuFor's
 * own passthrough in ContextMenu.tsx).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router";
import { cn } from "../../lib/cn";
import { ContextMenuFor } from "./ContextMenu";
import { MenuButton } from "./DropdownMenu";
import type { MenuItem } from "./Menu";

const INNER_CONTROL = "a,button,input,select,textarea,[role=button],[role=menuitem],[role=menu]";

export interface ClickableProps extends Omit<HTMLAttributes<HTMLElement>, "onClick"> {
  as?: "div" | "tr" | "li";
  to?: string;
  onActivate?: () => void;
  menu?: MenuItem[];
  /** Kebab accessible name; defaults to `common:ui.openMenu`. */
  menuLabel?: string;
  /** Render the kebab; defaults to true when `menu` is given. Pass false for `as="tr"`. */
  kebab?: boolean;
  children?: ReactNode;
}

export function Clickable({
  as: Tag = "div",
  to,
  onActivate,
  menu,
  menuLabel,
  kebab,
  children,
  className,
  ...rest
}: ClickableProps) {
  const navigate = useNavigate();
  const interactive = Boolean(to || onActivate);
  const showKebab = Boolean(menu) && (kebab ?? Tag !== "tr");

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    // A drag-selection that starts and ends inside the row ends in a click;
    // let the user select text instead of navigating away from it (mirrors
    // the contextmenu selection pass-through below).
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
    if ((e.target as Element).closest(INNER_CONTROL)) return;
    if (to && (e.ctrlKey || e.metaKey || e.button === 1)) {
      window.open(to, "_blank", "noopener");
      return;
    }
    if (to) navigate(to);
    else onActivate?.();
  };

  const node = (
    <Tag
      className={cn(className, showKebab && "group", interactive && "cursor-pointer")}
      data-menu={menu ? "" : undefined}
      onClick={interactive ? handleClick : undefined}
      onAuxClick={
        interactive && to
          ? (e: MouseEvent<HTMLElement>) => {
              // auxclick also fires for button 2 (right); only middle opens a tab.
              if (e.button === 1) handleClick(e);
            }
          : undefined
      }
      {...rest}
    >
      {children}
      {showKebab && menu && <MenuButton size="xs" items={menu} label={menuLabel} reveal />}
    </Tag>
  );

  return menu ? <ContextMenuFor items={menu}>{node}</ContextMenuFor> : node;
}
