/**
 * @file index.ts
 * @description Barrel for the domain-agnostic UI kit atoms (buttons, badges,
 * tabs, menus, Clickable, headers). Types are re-exported with `export type`
 * because the client compiles with `isolatedModules`.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

export { Button } from "./Button";
export type { ButtonProps } from "./Button";
export { IconButton } from "./IconButton";
export type { IconButtonProps } from "./IconButton";
export { Badge } from "./Badge";
export type { BadgeProps } from "./Badge";
export { LivePill } from "./LivePill";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./Tabs";
export type { TabsListProps, TabsTriggerProps } from "./Tabs";
export { SegmentedControl } from "./SegmentedControl";
export type { SegmentedControlProps, SegmentedItem } from "./SegmentedControl";
export { MenuItems, menuItemClass } from "./Menu";
export type { MenuItem, MenuParts } from "./Menu";
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuFor,
  menuContentClass,
} from "./ContextMenu";
export type { ContextMenuForProps } from "./ContextMenu";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  MenuButton,
} from "./DropdownMenu";
export type { MenuButtonProps } from "./DropdownMenu";
export { Clickable } from "./Clickable";
export type { ClickableProps } from "./Clickable";
export { PageHeader } from "./PageHeader";
export type { PageHeaderProps } from "./PageHeader";
export { SectionHeader } from "./SectionHeader";
export type { SectionHeaderProps } from "./SectionHeader";
