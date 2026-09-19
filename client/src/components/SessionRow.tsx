/**
 * @file SessionRow.tsx
 * @description One row of the Sessions table: a Clickable `<tr>` linking to the
 * session with an EntityRef name, model / project chips, remote-source and
 * Run-page badges, status with optional task-progress donut, timing, agent
 * count, cost, and a trailing kebab carrying the session's entity menu. The
 * local transient Codex startup row (no durable id yet) renders the same cells
 * without links or a menu.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Play, Server } from "lucide-react";
import { SessionStatusBadge } from "./StatusBadge";
import { TodoProgressIndicator } from "./TodoProgressIndicator";
import { Badge, Clickable, MenuButton } from "./ui";
import { EntityRef, entityMenu } from "./entity";
import { copyText } from "../lib/clipboard";
import { routes } from "../lib/routes";
import {
  formatDateTime,
  formatDuration,
  formatModelName,
  fmtCost,
  isTransientProcess,
} from "../lib/format";
import { effectiveSessionStatus, sessionAwaitingReason } from "../lib/types";
import type { Session } from "../lib/types";

export interface SessionRowProps {
  session: Session;
  /** Friendly label for `session.source` when it is a remote machine. */
  sourceLabel?: string;
  /** Whether an in-flight Run-page handle is currently driving this session. */
  isDashboardRun?: boolean;
}

/** Column count the Sessions table renders — keeps the skeleton rows aligned. */
export const SESSION_ROW_COLUMNS = 8;

export function SessionRow({ session, sourceLabel, isDashboardRun = false }: SessionRowProps) {
  const { t } = useTranslation("sessions");
  const transient = isTransientProcess(session.metadata);
  const menu = transient
    ? undefined
    : entityMenu(
        {
          kind: "session",
          id: session.id,
          name: session.name,
          cwd: session.cwd,
          source: session.source,
        },
        { t, copy: copyText }
      );
  return (
    <Clickable
      as="tr"
      to={transient ? undefined : routes.session(session.id)}
      menu={menu}
      kebab={false}
      className="hover:bg-surface-4 transition-colors group"
    >
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-200 truncate">
              <EntityRef
                kind="session"
                id={session.id}
                name={session.name}
                cwd={session.cwd}
                source={session.source}
                transient={transient}
                mono={false}
                className="text-sm font-medium text-gray-200"
              />
            </p>
            <p className="text-[11px] text-gray-600 font-mono truncate">
              {session.id.slice(0, 12)}
              {session.model && !transient && (
                <>
                  {" · "}
                  <EntityRef
                    kind="model"
                    model={session.model}
                    className="text-gray-500"
                    tabbable={false}
                  >
                    {formatModelName(session.model)}
                  </EntityRef>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {session.source && session.source !== "local" && (
              <Badge
                tone="info"
                size="xs"
                icon={Server}
                title={t("remoteSourceBadgeTitle", "Collected from a remote machine")}
              >
                {sourceLabel || session.source}
              </Badge>
            )}
            {isDashboardRun && (
              <Link
                to={routes.run({ session: session.id })}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 hover:text-emerald-200 px-1.5 py-0.5 rounded-full transition-colors"
                title={t("dashboardRunBadge", "Driven by Run page · click to open")}
              >
                <Play className="w-2.5 h-2.5" />
                {t("common:dashboardRun", "Run")}
              </Link>
            )}
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-2">
          <SessionStatusBadge
            status={effectiveSessionStatus(session)}
            reason={sessionAwaitingReason(session)}
            provider={session.provider}
          />
          {session.todo_summary && <TodoProgressIndicator progress={session.todo_summary} />}
        </div>
      </td>
      <td className="px-5 py-4 text-sm text-gray-400">
        {formatDateTime(session.last_activity || session.started_at)}
      </td>
      <td className="px-5 py-4 text-sm text-gray-400 font-mono">
        {session.ended_at
          ? formatDuration(session.started_at, session.ended_at)
          : t("common:running")}
      </td>
      <td className="px-5 py-4 text-sm text-gray-400">
        {session.agent_count != null && !transient ? (
          <Link
            to={routes.session(session.id, { tab: "agents" })}
            title={t("detail.agents")}
            className="hover:text-gray-200 hover:underline decoration-dotted underline-offset-2"
          >
            {session.agent_count}
          </Link>
        ) : (
          (session.agent_count ?? "-")
        )}
      </td>
      <td className="px-5 py-4 text-sm text-gray-400 font-mono">
        {session.cost != null && session.cost > 0 ? fmtCost(session.cost) : "-"}
      </td>
      <td className="px-5 py-4 text-[11px] text-gray-500 font-mono max-w-[16rem]">
        {session.cwd ? (
          <EntityRef
            kind="project"
            cwd={session.cwd}
            source={session.source}
            className="text-gray-500"
            tabbable={false}
          />
        ) : (
          "-"
        )}
      </td>
      <td className="px-3 py-4">
        {menu && (
          <MenuButton
            size="xs"
            items={menu}
            label={t("common:ui.openMenuFor", {
              name: session.name?.trim() || session.id.slice(0, 8),
            })}
            reveal
          />
        )}
      </td>
    </Clickable>
  );
}
