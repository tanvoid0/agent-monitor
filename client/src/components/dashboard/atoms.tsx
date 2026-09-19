/**
 * @file atoms.tsx
 * @description Small presentational pieces shared by the Health tab's panel
 * grid: a card shell with a `SectionHeader`, a label/value row, a centered
 * mini-stat, and a labelled progress bar. Extracted from `SystemHealthTab`
 * where these shapes were copy-pasted across its nine panels.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { SectionHeader } from "../ui";
import { Tip } from "../Tip";

/** Panel shell: `card` surface + `SectionHeader` + body. */
export function HealthPanel({
  icon,
  title,
  actions,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card p-5 flex flex-col gap-4">
      <SectionHeader icon={icon} title={title} actions={actions} />
      {children}
    </div>
  );
}

/** Label/value row: fixed-width label, value node supplies its own styling. */
export function KeyValueRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-28 flex-shrink-0">{label}</span>
      {children}
    </div>
  );
}

/** Centered uppercase label over a bold mono value, wrapped in a `Tip`. */
export function MiniStat({
  label,
  value,
  tone,
  tip,
  size = "xs",
}: {
  label: string;
  value: ReactNode;
  tone: string;
  tip: string;
  size?: "xs" | "sm";
}) {
  return (
    <Tip block raw={tip}>
      <div className="text-center cursor-default">
        <p className="text-[9px] text-gray-600 uppercase">{label}</p>
        <p className={`${size === "sm" ? "text-sm" : "text-xs"} font-mono font-bold ${tone}`}>
          {value}
        </p>
      </div>
    </Tip>
  );
}

/** Labelled progress bar row: caller supplies its own label/value nodes since
 * those vary (EntityRef chip, plain span, different widths/colors). */
export function RatioBar({
  label,
  pct,
  color,
  value,
  tip,
  duration = "duration-500",
}: {
  label: ReactNode;
  pct: number;
  color: string | undefined; // indexed palette lookups are `string | undefined`
  value: ReactNode;
  tip: string;
  duration?: string;
}) {
  return (
    <Tip block raw={tip}>
      <div className="flex items-center gap-3 cursor-default">
        {label}
        <div className="flex-1 bg-surface-3 rounded-full h-2">
          <div
            className={`${color} h-2 rounded-full transition-all ${duration}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {value}
      </div>
    </Tip>
  );
}
