/**
 * @file DropdownMenu.tsx
 * @description Styled Radix DropdownMenu wrappers plus `MenuButton`, the
 * kebab (⋯) trigger that opens a `MenuItem[]` aligned to its end. Radix
 * supplies `aria-haspopup` / `aria-expanded` on the trigger.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { menuContentClass, stopEscape } from "./ContextMenu";
import { IconButton } from "./IconButton";
import { MenuItems, type MenuItem } from "./Menu";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuItem = Primitive.Item;
export const DropdownMenuSeparator = Primitive.Separator;
export const DropdownMenuLabel = Primitive.Label;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Primitive.Content>
>(function DropdownMenuContent(
  { className, align = "end", sideOffset = 4, onEscapeKeyDown, ...props },
  ref
) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(menuContentClass, className)}
        onEscapeKeyDown={stopEscape(onEscapeKeyDown)}
        {...props}
      />
    </Primitive.Portal>
  );
});

export interface MenuButtonProps {
  items: MenuItem[];
  /** Accessible name; defaults to `common:ui.openMenu`. */
  label?: string;
  size?: "xs" | "sm";
  className?: string;
  /** Hide until row hover/focus/touch/open, as row kebabs do. */
  reveal?: boolean;
}

const revealClass =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 data-[state=open]:opacity-100";

/** Kebab trigger + dropdown of `items`. */
export function MenuButton({ items, label, size = "sm", className, reveal }: MenuButtonProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={MoreHorizontal}
          label={label ?? t("common:ui.openMenu")}
          size={size}
          className={cn(reveal && revealClass, className)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <MenuItems
          items={items}
          Item={DropdownMenuItem}
          Separator={DropdownMenuSeparator}
          Label={DropdownMenuLabel}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
