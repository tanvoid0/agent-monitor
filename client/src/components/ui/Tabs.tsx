/**
 * @file Tabs.tsx
 * @description Thin styled wrappers over Radix Tabs. `TabsList` is segmented
 * by default or `variant="underline"`; `TabsTrigger` reads that variant from
 * context to pick its selected styling and accepts an optional icon and count.
 * Callers must render a `TabsContent` per tab so Radix can wire
 * `aria-controls`.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { createContext, forwardRef, useContext, type ComponentPropsWithoutRef } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "./Badge";

type ListVariant = "segmented" | "underline";
const VariantCtx = createContext<ListVariant>("segmented");

export const Tabs = TabsPrimitive.Root;

export interface TabsListProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: ListVariant;
}

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { variant = "segmented", className, ...props },
  ref
) {
  return (
    <VariantCtx.Provider value={variant}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          variant === "underline"
            ? "flex items-center gap-1 border-b border-border"
            : "inline-flex bg-surface-2 rounded-lg p-0.5 border border-border",
          className
        )}
        {...props}
      />
    </VariantCtx.Provider>
  );
});

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  icon?: LucideIcon;
  count?: number;
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(function TabsTrigger(
  { icon: Icon, count, className, children, ...props },
  ref
) {
  const variant = useContext(VariantCtx);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:pointer-events-none",
        variant === "underline"
          ? "px-3 py-2 -mb-px border-b-2 border-transparent data-[state=active]:border-accent data-[state=active]:text-gray-100"
          : "px-3 py-1.5 rounded-md data-[state=active]:bg-surface-4 data-[state=active]:text-gray-100",
        className
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden className="w-3.5 h-3.5 shrink-0" />}
      {children}
      {count !== undefined && <Badge size="xs">{count}</Badge>}
    </TabsPrimitive.Trigger>
  );
});

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn("outline-none", className)} {...props} />;
});
