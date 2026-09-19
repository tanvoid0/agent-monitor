/**
 * @file Menu.tsx
 * @description Shared menu vocabulary for the kit: the `MenuItem` union
 * (action, link, separator, label) and `MenuItems`, which renders a list of
 * them with whichever Radix parts it is handed (ContextMenu.* or
 * DropdownMenu.*). Link items slot a react-router `<Link>` so modified clicks
 * open a new tab natively.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import type {
  ContextMenuItemProps,
  ContextMenuLabelProps,
  ContextMenuSeparatorProps,
} from "@radix-ui/react-context-menu";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

export type MenuItem =
  | {
      label: string;
      icon?: LucideIcon;
      onSelect?: () => void | Promise<void>;
      to?: string;
      danger?: boolean;
      disabled?: boolean;
    }
  | { type: "separator" }
  | { type: "label"; label: string };

/** Radix parts to render with — ContextMenu and DropdownMenu share prop shapes. */
export interface MenuParts {
  Item: ComponentType<ContextMenuItemProps>;
  Separator: ComponentType<ContextMenuSeparatorProps>;
  Label: ComponentType<ContextMenuLabelProps>;
}

export const menuItemClass =
  "flex items-center gap-2 px-2.5 py-1.5 text-sm text-gray-200 rounded-md cursor-default select-none outline-none data-[highlighted]:bg-surface-4 data-[disabled]:opacity-50";

export function MenuItems({ items, Item, Separator, Label }: { items: MenuItem[] } & MenuParts) {
  return items.map((item, i): ReactNode => {
    if ("type" in item) {
      if (item.type === "separator") return <Separator key={i} className="my-1 h-px bg-border" />;
      return (
        <Label
          key={i}
          title={item.label}
          className="px-2.5 py-1.5 text-[11px] font-mono text-gray-400 truncate max-w-[24rem]"
        >
          {item.label}
        </Label>
      );
    }
    const { label, icon: Icon, onSelect, to, danger, disabled } = item;
    // Defer past Radix's handleSelect: it still holds the FocusScope trap when
    // onSelect runs, which reverts textarea.select() focus and breaks the
    // lib/clipboard execCommand fallback.
    const deferredSelect = onSelect
      ? () => {
          window.setTimeout(() => void onSelect(), 0);
        }
      : undefined;
    const classes = cn(
      menuItemClass,
      danger && "text-red-300 focus:bg-red-500/10 data-[highlighted]:bg-red-500/10"
    );
    const body = (
      <>
        {Icon && <Icon aria-hidden className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
      </>
    );
    if (to) {
      return (
        <Item key={i} asChild disabled={disabled} className={classes} onSelect={deferredSelect}>
          <Link
            to={to}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : undefined}
            onClick={disabled ? (e) => e.preventDefault() : undefined}
          >
            {body}
          </Link>
        </Item>
      );
    }
    return (
      <Item key={i} disabled={disabled} className={classes} onSelect={deferredSelect}>
        {body}
      </Item>
    );
  });
}
