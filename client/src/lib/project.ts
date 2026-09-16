/**
 * @file project.ts
 * @description Pure project-grouping helpers shared by `ProjectBadge` and
 * `entity/entityMenu`: cwd normalization, worktree/container-dir folding into
 * a group root (`projectRoots`/`projectRootOf`), the label/sub-path split
 * (`projectLabel`/`projectParts`), a stable per-root colour (`projectColor`),
 * and `revealCwd`, the shared "open in file manager" side effect. Kept out of
 * `components/` so `ProjectBadge` (which renders an `EntityRef`) and
 * `entityMenu` (which `EntityRef` uses to build its menu) can both depend on
 * it without a cycle.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { TFunction } from "i18next";
import { api } from "./api";
import { announceAction } from "./appEvents";
import { pathBasename } from "./format";

/** Forward slashes, no trailing slash (a bare root stays `/` or `C:`) — so
 *  Windows and POSIX cwds compare. */
export function normalizeCwd(cwd: string): string {
  const flat = cwd.replace(/\\/g, "/");
  return flat.replace(/\/+$/, "") || flat.slice(0, 1);
}

/** Directories that hold projects rather than being one: `/`, a drive root,
 *  or a home directory. A session started there must not swallow every project
 *  beneath it into one group.
 *  ponytail: a fixed shape list; upgrade to server-side git-root detection if
 *  a workspace root like `D:/projects` starts absorbing its children. */
function isContainerDir(dir: string): boolean {
  return /^(?:\/|[A-Za-z]:|\/root|(?:\/Users|\/home|[A-Za-z]:\/Users)\/[^/]+)$/.test(dir);
}

/** `<repo>/.claude/worktrees/<name>` and `<repo>/.worktrees/<name>` are
 *  checkouts of `<repo>`, not projects of their own. */
function stripWorktree(cwd: string): string {
  return cwd.replace(/\/(?:\.claude\/worktrees|\.worktrees)\/[^/]+$/, "");
}

/**
 * Map every known cwd to its project group root: the shortest known cwd that
 * is the cwd itself or one of its ancestors, never a container directory
 * (root, drive, home). A session started in `repo/apps/web` groups under
 * `repo` when some session ran at `repo`; a worktree groups under its repo
 * even when none did.
 */
export function projectRoots(cwds: readonly (string | null | undefined)[]): Map<string, string> {
  const raw = [...new Set(cwds.filter((c): c is string => Boolean(c)))];
  const candidates = [...new Set(raw.map((c) => stripWorktree(normalizeCwd(c))))]
    .filter((c) => !isContainerDir(c))
    .sort((a, b) => a.length - b.length);
  const roots = new Map<string, string>();
  for (const cwd of raw) {
    const own = stripWorktree(normalizeCwd(cwd));
    // ponytail: O(n²) over distinct cwds — fine for the hundreds a board holds.
    const root = candidates.find((c) => own === c || own.startsWith(`${c}/`)) ?? own;
    // Keyed by the cwd as stored (so `roots.get(session.cwd)` just works on
    // Windows) and by its normalized form.
    roots.set(cwd, root);
    roots.set(normalizeCwd(cwd), root);
  }
  return roots;
}

/** Group root for one cwd when no board-wide map is available. */
export function projectRootOf(cwd: string): string {
  return stripWorktree(normalizeCwd(cwd));
}

export function projectLabel(root: string): string {
  return pathBasename(root) || root;
}

/** Group folder name plus the sub-path below it. `root` defaults to the cwd's
 *  own group root when the caller has no board-wide map. */
export function projectParts(cwd: string, root?: string): { label: string; sub: string } {
  const normalized = normalizeCwd(cwd);
  const groupRoot = root ?? projectRootOf(cwd);
  const sub = normalized.startsWith(`${groupRoot}/`) ? normalized.slice(groupRoot.length + 1) : "";
  return { label: projectLabel(groupRoot), sub };
}

/** Literal class strings so Tailwind keeps them. Muted enough to sit beside
 *  the status colours (emerald/amber/violet/red) without competing. */
const PALETTE = [
  { dot: "bg-sky-400", badge: "bg-sky-500/10 border-sky-500/25 text-sky-300" },
  { dot: "bg-rose-400", badge: "bg-rose-500/10 border-rose-500/25 text-rose-300" },
  { dot: "bg-teal-400", badge: "bg-teal-500/10 border-teal-500/25 text-teal-300" },
  { dot: "bg-orange-400", badge: "bg-orange-500/10 border-orange-500/25 text-orange-300" },
  { dot: "bg-indigo-400", badge: "bg-indigo-500/10 border-indigo-500/25 text-indigo-300" },
  { dot: "bg-lime-400", badge: "bg-lime-500/10 border-lime-500/25 text-lime-300" },
  { dot: "bg-fuchsia-400", badge: "bg-fuchsia-500/10 border-fuchsia-500/25 text-fuchsia-300" },
  { dot: "bg-cyan-400", badge: "bg-cyan-500/10 border-cyan-500/25 text-cyan-300" },
  { dot: "bg-pink-400", badge: "bg-pink-500/10 border-pink-500/25 text-pink-300" },
  { dot: "bg-blue-400", badge: "bg-blue-500/10 border-blue-500/25 text-blue-300" },
] as const;

export function projectColor(root: string): (typeof PALETTE)[number] {
  let hash = 0;
  for (let i = 0; i < root.length; i++) hash = (hash * 31 + root.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

/** Open `cwd` in the OS file manager via the server and toast the outcome.
 *  Shared by `ProjectBadge`'s open button and `entityMenu`'s "Reveal folder".
 *  `root` defaults to the cwd's own group root, same as `projectParts`; `open`
 *  defaults to `api.sessions.openCwd` (entityMenu passes a caller override). */
export async function revealCwd(
  cwd: string,
  t: TFunction,
  root?: string,
  open: (cwd: string) => Promise<unknown> = api.sessions.openCwd
): Promise<void> {
  const name = projectLabel(root ?? projectRootOf(cwd));
  try {
    await open(cwd);
    announceAction(t("kanban:project.opened", { name }));
  } catch (err) {
    announceAction(
      t("kanban:project.openFailed", { message: err instanceof Error ? err.message : String(err) })
    );
  }
}
