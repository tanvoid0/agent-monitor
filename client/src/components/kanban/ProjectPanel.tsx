/**
 * @file Project side panel shared by the Kanban board and the Sessions list.
 * Lists every project group with live counts (active · waiting · unseen
 * completed), supports multi-select (empty = all), substring search, and sort
 * by name / recent activity / session count. Collapsed state and sort persist
 * per browser (one preference for both pages); "seen" timestamps (for the
 * unseen-completed count) are stamped when a Kanban project is selected. Pure
 * helpers are exported so each page computes rows from what it already holds:
 * `buildProjectRows` folds loaded sessions (Kanban), `buildProjectRowsFromFacets`
 * folds the server's per-cwd counts (Sessions, which pages its list).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderKanban, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge, IconButton, MenuButton } from "../ui";
import type { Session, SessionProjectFacet } from "../../lib/types";
import { isSessionAwaitingInput } from "../../lib/types";

export interface ProjectRow {
  root: string;
  label: string;
  /** Tailwind class for the colour dot (from `projectColor(root).dot`). */
  dot: string;
  /** Sessions (or agents) in the current board view. */
  count: number;
  active: number;
  waiting: number;
  /** Completed sessions that ended after the project was last selected. */
  unseenDone: number;
  /** ISO timestamp of the newest activity, for the "recent" sort. */
  lastActivity: string;
}

export type ProjectSort = "name" | "recent" | "count";

const STORAGE_KEY = "kanban-project-panel";
const SEEN_KEY = "kanban-project-seen";

/** `?project=a,b` → roots; blank/absent → [] (all projects). */
export function parseProjectParam(raw: string | null): string[] {
  return (raw ?? "").split(",").filter(Boolean);
}

/** Two projects with the same basename get their parent dir appended so the
 *  rows stay tellable apart (the moved-repo case: `D:\a\x` vs `D:\b\x`). */
export function disambiguate<T extends { root: string; label: string }>(rows: T[]): T[] {
  const byLabel = new Map<string, number>();
  for (const r of rows) byLabel.set(r.label, (byLabel.get(r.label) ?? 0) + 1);
  return rows.map((r) => {
    if ((byLabel.get(r.label) ?? 0) < 2) return r;
    const parts = r.root.split(/[\\/]/).filter(Boolean);
    const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
    return parent ? { ...r, label: `${parent}/${r.label}` } : r;
  });
}

interface RowInput {
  sessions: Session[];
  /** cwd → group root, from `projectRoots()`. */
  rootByCwd: Map<string, string>;
  labelOf: (root: string) => string;
  dotOf: (root: string) => string;
  /** Per-root ISO timestamp of the last time the user selected it. */
  seenAt: Record<string, string>;
  /** Per-root count for the current view (agents or sessions). */
  countOf: (root: string) => number;
}

/** Fold sessions into one row per project group. Pure; page-side memoised. */
export function buildProjectRows({
  sessions,
  rootByCwd,
  labelOf,
  dotOf,
  seenAt,
  countOf,
}: RowInput): ProjectRow[] {
  const rows = new Map<string, ProjectRow>();
  for (const root of new Set(rootByCwd.values())) {
    rows.set(root, {
      root,
      label: labelOf(root),
      dot: dotOf(root),
      count: countOf(root),
      active: 0,
      waiting: 0,
      unseenDone: 0,
      lastActivity: "",
    });
  }
  for (const s of sessions) {
    const root = s.cwd ? rootByCwd.get(s.cwd) : undefined;
    const row = root ? rows.get(root) : undefined;
    if (!row) continue;
    if (isSessionAwaitingInput(s)) row.waiting++;
    else if (s.status === "active") row.active++;
    else if (s.status === "completed" && s.ended_at && s.ended_at > (seenAt[root!] ?? "")) {
      row.unseenDone++;
    }
    const ts = s.last_activity ?? s.ended_at ?? s.started_at ?? "";
    if (ts > row.lastActivity) row.lastActivity = ts;
  }
  return disambiguate([...rows.values()]);
}

/** Fold per-cwd counts from `GET /api/sessions/facets` into one row per
 *  project group. No per-session data, so `unseenDone` stays 0. Pure. */
export function buildProjectRowsFromFacets(
  facets: SessionProjectFacet[],
  rootByCwd: Map<string, string>,
  labelOf: (root: string) => string,
  dotOf: (root: string) => string
): ProjectRow[] {
  const rows = new Map<string, ProjectRow>();
  for (const f of facets) {
    const root = rootByCwd.get(f.cwd);
    if (!root) continue;
    let row = rows.get(root);
    if (!row) {
      row = {
        root,
        label: labelOf(root),
        dot: dotOf(root),
        count: 0,
        active: 0,
        waiting: 0,
        unseenDone: 0,
        lastActivity: "",
      };
      rows.set(root, row);
    }
    row.count += f.count;
    row.active += f.active;
    row.waiting += f.waiting;
    if (f.last_activity > row.lastActivity) row.lastActivity = f.last_activity;
  }
  return disambiguate([...rows.values()]);
}

export function sortRows(rows: ProjectRow[], sort: ProjectSort): ProjectRow[] {
  const byName = (a: ProjectRow, b: ProjectRow) =>
    a.label.localeCompare(b.label) || a.root.localeCompare(b.root);
  return [...rows].sort((a, b) => {
    if (sort === "recent") return b.lastActivity.localeCompare(a.lastActivity) || byName(a, b);
    if (sort === "count") return b.count - a.count || byName(a, b);
    return byName(a, b);
  });
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — panel still works, just not remembered */
  }
}

/** Per-root "last selected" timestamps behind the unseen-completed count. */
export function useSeenProjects(): [Record<string, string>, (roots: string[]) => void] {
  const [seenAt, setSeenAt] = useState<Record<string, string>>(() => readJson(SEEN_KEY, {}));
  const markSeen = (roots: string[]) => {
    if (!roots.length) return;
    setSeenAt((prev) => {
      const now = new Date().toISOString();
      const next = { ...prev };
      for (const r of roots) next[r] = now;
      writeJson(SEEN_KEY, next);
      return next;
    });
  };
  return [seenAt, markSeen];
}

export interface ProjectPanelProps {
  rows: ProjectRow[];
  /** Selected roots; empty = every project. */
  selected: string[];
  onChange: (roots: string[]) => void;
  total: number;
}

export function ProjectPanel({ rows, selected, onChange, total }: ProjectPanelProps) {
  const { t } = useTranslation("kanban");
  const [prefs, setPrefs] = useState<{ collapsed: boolean; sort: ProjectSort }>(() =>
    readJson(STORAGE_KEY, { collapsed: false, sort: "name" })
  );
  const [query, setQuery] = useState("");
  useEffect(() => writeJson(STORAGE_KEY, prefs), [prefs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => r.label.toLowerCase().includes(q) || r.root.toLowerCase().includes(q))
      : rows;
    return sortRows(filtered, prefs.sort);
  }, [rows, query, prefs.sort]);

  const selectedSet = new Set(selected);
  const toggle = (root: string) =>
    onChange(selectedSet.has(root) ? selected.filter((r) => r !== root) : [...selected, root]);

  const sortItems = (["name", "recent", "count"] as const).map((s) => ({
    label: t(`projectPanel.sort.${s}`),
    onSelect: () => setPrefs((p) => ({ ...p, sort: s })),
  }));

  if (prefs.collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 pt-1">
        <IconButton
          icon={PanelLeftOpen}
          label={t("projectPanel.expand")}
          size="sm"
          onClick={() => setPrefs((p) => ({ ...p, collapsed: false }))}
        />
        {selected.length > 0 && <Badge size="xs">{selected.length}</Badge>}
      </div>
    );
  }

  return (
    <aside
      aria-label={t("projectPanel.title")}
      className="card flex w-64 shrink-0 flex-col self-start overflow-hidden"
    >
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <FolderKanban className="h-3.5 w-3.5 text-gray-500" />
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t("projectPanel.title")}
        </span>
        <MenuButton items={sortItems} label={t("projectPanel.sort.label")} size="xs" />
        <IconButton
          icon={PanelLeftClose}
          label={t("projectPanel.collapse")}
          size="xs"
          onClick={() => setPrefs((p) => ({ ...p, collapsed: true }))}
        />
      </div>

      <label className="relative block border-b border-border">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("projectPanel.search")}
          aria-label={t("projectPanel.search")}
          className="w-full bg-transparent py-1.5 pl-8 pr-2 text-xs text-gray-200 placeholder-gray-500 outline-none"
        />
      </label>

      <ul role="listbox" aria-multiselectable="true" className="max-h-[70vh] overflow-y-auto py-1">
        <li>
          <button
            type="button"
            role="option"
            aria-selected={selected.length === 0}
            onClick={() => onChange([])}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs",
              selected.length === 0
                ? "bg-accent/10 text-accent"
                : "text-gray-300 hover:bg-surface-4"
            )}
          >
            <span className="flex-1 truncate">{t("projectPanel.all")}</span>
            <Badge size="xs">{total}</Badge>
          </button>
        </li>
        {visible.map((r) => {
          const on = selectedSet.has(r.root);
          return (
            <li key={r.root}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                title={r.root}
                onClick={() => toggle(r.root)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs",
                  on ? "bg-accent/10 text-gray-100" : "text-gray-300 hover:bg-surface-4"
                )}
              >
                <input
                  type="checkbox"
                  readOnly
                  tabIndex={-1}
                  checked={on}
                  className="h-3 w-3 accent-accent"
                />
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", r.dot)} />
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                {r.active > 0 && (
                  <Badge tone="success" size="xs" title={t("projectPanel.active")}>
                    {r.active}
                  </Badge>
                )}
                {r.waiting > 0 && (
                  <Badge tone="warning" size="xs" title={t("projectPanel.waiting")}>
                    {r.waiting}
                  </Badge>
                )}
                {r.unseenDone > 0 && (
                  <Badge tone="info" size="xs" title={t("projectPanel.unseen")}>
                    {r.unseenDone}
                  </Badge>
                )}
                <span className="tabular-nums text-gray-500">{r.count}</span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-2.5 py-3 text-center text-xs text-gray-500">
            {t("projectPanel.noMatch")}
          </li>
        )}
      </ul>

      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="flex items-center justify-center gap-1 border-t border-border py-1.5 text-xs text-gray-400 hover:text-gray-200"
        >
          <X className="h-3 w-3" />
          {t("projectPanel.clear", { count: selected.length })}
        </button>
      )}
    </aside>
  );
}
