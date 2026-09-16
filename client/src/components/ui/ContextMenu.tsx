/**
 * @file ContextMenu.tsx
 * @description Styled Radix ContextMenu wrappers (right-click / long-press).
 * `ContextMenuContent` portals and stops Escape from propagating so an
 * enclosing modal's window listener does not also close. `ContextMenuFor`
 * is the one-liner: wrap any element with a `MenuItem[]`. `menuContentClass`
 * and `stopEscape` are shared here with DropdownMenu's Content wrapper.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactElement,
} from "react";
import * as Primitive from "@radix-ui/react-context-menu";
import { cn } from "../../lib/cn";
import { MenuItems, type MenuItem } from "./Menu";

/** Let a shift+right-click or an active text selection fall through to the
 *  browser's native context menu instead of opening the Radix one — stop the
 *  event before Radix's own bubble-phase contextmenu listener runs. Shared by
 *  every `ContextMenuFor` consumer (Clickable rows, EntityRef, ...). */
export function nativeMenuPassthroughCapture(e: MouseEvent<HTMLElement>) {
  if (e.shiftKey || window.getSelection()?.toString()) e.stopPropagation();
}

export const menuContentClass =
  "min-w-[12rem] bg-surface-3 border border-border rounded-lg p-1 shadow-xl z-[110] text-sm"; // above every overlay (modals z-50/z-[75]/z-[100])

/** Stop Escape from reaching an enclosing modal's window listener, then run
 *  the caller's own handler if it gave one. Shared by both Content wrappers. */
export function stopEscape<E extends { stopPropagation: () => void }>(
  onEscapeKeyDown?: (e: E) => void
) {
  return (e: E) => {
    e.stopPropagation();
    onEscapeKeyDown?.(e);
  };
}

export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export const ContextMenuItem = Primitive.Item;
export const ContextMenuSeparator = Primitive.Separator;
export const ContextMenuLabel = Primitive.Label;

export const ContextMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Primitive.Content>
>(function ContextMenuContent({ className, onEscapeKeyDown, ...props }, ref) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        ref={ref}
        className={cn(menuContentClass, className)}
        onEscapeKeyDown={stopEscape(onEscapeKeyDown)}
        {...props}
      />
    </Primitive.Portal>
  );
});

export interface ContextMenuForProps {
  items: MenuItem[];
  /** Let the native context menu through instead. */
  disabled?: boolean;
  children: ReactElement;
}

/** Root + Trigger(asChild) + Content(MenuItems) in one. */
export function ContextMenuFor({ items, disabled, children }: ContextMenuForProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        disabled={disabled}
        // A touch long-press starts Radix's 700ms timer on every ancestor
        // trigger too (e.g. an EntityRef's own ContextMenuFor nested inside a
        // Clickable row's) — stop it here so only the innermost one opens.
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") e.stopPropagation();
        }}
        onContextMenuCapture={nativeMenuPassthroughCapture}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuItems
          items={items}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
          Label={ContextMenuLabel}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
