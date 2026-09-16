/**
 * @file SegmentedControl.tsx
 * @description Single-select segmented control over Radix ToggleGroup
 * (`role="radiogroup"` / `role="radio"`, `aria-checked`). Never goes empty:
 * re-selecting the current item is a no-op. Same look as the segmented
 * `TabsList`; use it for filters and toggles, not for panel switching.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { cn } from "../../lib/cn";

export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  items: SegmentedItem<T>[];
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  items,
  ariaLabel,
  size = "md",
  className,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      aria-label={ariaLabel}
      className={cn("inline-flex bg-surface-2 rounded-lg p-0.5 border border-border", className)}
    >
      {items.map(({ value: itemValue, label }) => (
        <ToggleGroup.Item
          key={itemValue}
          value={itemValue}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-medium text-gray-400 hover:text-gray-200 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none data-[state=on]:bg-surface-4 data-[state=on]:text-gray-100",
            size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
          )}
        >
          {label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
