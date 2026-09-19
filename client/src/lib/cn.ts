/**
 * @file cn.ts
 * @description Class-name merge helper for the UI kit: `clsx` for conditional
 * joins, then `tailwind-merge` so a caller's `className` overrides conflicting
 * variant utilities (e.g. `p-0` beats `px-4 py-2`).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class lists; later conflicting utilities win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
