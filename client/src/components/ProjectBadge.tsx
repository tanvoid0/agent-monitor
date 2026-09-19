/**
 * @file ProjectBadge.tsx
 * @description The project chip shown on agent and session cards: a colour
 * dot keyed to the project group, an `EntityRef` link (group folder name plus
 * the sub-path when the session ran below the group root, full cwd as its
 * title, project context menu on right-click) and, for local sessions, a
 * button that reveals the directory in the OS file manager via
 * `POST /api/sessions/open-cwd`.
 *
 * Also exports the pure grouping helpers the Kanban board's project tabs use:
 * `normalizeCwd` (one separator style), `projectRoots` (each known cwd → the
 * shortest known ancestor cwd, worktree checkouts collapsed onto their repo)
 * and `projectColor` (a stable palette pick per group root, so the same group
 * reads the same colour on every card and every tab).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { projectColor, projectParts, projectRootOf, revealCwd } from "../lib/project";
import { EntityRef } from "./entity";

// Re-exported so KanbanBoard/entityMenu callers keep working unchanged.
export {
  normalizeCwd,
  projectRoots,
  projectRootOf,
  projectLabel,
  projectColor,
} from "../lib/project";

interface ProjectBadgeProps {
  cwd: string;
  /** Group root from `projectRoots`; defaults to the cwd's own root. */
  root?: string;
  /** `sessions.source` — the open button only makes sense for `local`. */
  source?: string | null;
  className?: string;
}

export function ProjectBadge({ cwd, root, source, className = "" }: ProjectBadgeProps) {
  const { t } = useTranslation();
  const groupRoot = root ?? projectRootOf(cwd);
  const { label, sub } = projectParts(cwd, groupRoot);
  const color = projectColor(groupRoot);
  const canOpen = !source || source === "local";

  function open(e: React.MouseEvent) {
    e.stopPropagation();
    void revealCwd(cwd, t, groupRoot);
  }

  return (
    <span
      className={`badge ${color.badge} text-[10px] py-0.5 px-1.5 gap-1 max-w-full min-w-0 ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color.dot}`} />
      <EntityRef kind="project" cwd={cwd} source={source} mono={false} className="text-current">
        {label}
        {sub && <span className="opacity-60"> · {sub}</span>}
      </EntityRef>
      {canOpen && (
        <button
          type="button"
          onClick={open}
          aria-label={t("kanban:project.open")}
          title={t("kanban:project.open")}
          className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        >
          <FolderOpen className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
