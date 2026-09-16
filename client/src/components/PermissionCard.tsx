/**
 * @file PermissionCard.tsx
 * @description One parked Claude Code permission prompt, with the answer
 * buttons that unblock the CLI. Shared by the global floating relay and the
 * session detail page's banner, so the two surfaces can never drift apart on
 * what a prompt looks like or what answering it does.
 *
 * `context` is shown only where the card can belong to any session (the
 * floating stack); on a session page the surrounding chrome already says which
 * session this is.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { summarisePermissionInput } from "../lib/permission-input";
import { PermissionInputView } from "./PermissionInputView";
import type { PermissionBehavior } from "../hooks/usePermissionRelay";
import type { PermissionRequest, PermissionUpdate } from "../lib/types";

function projectOf(cwd: string | null): string {
  return cwd ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd) : "";
}

/** The allow rule Claude Code suggested for this prompt, if any — what "Allow always" writes. */
export function allowAlwaysRule(req: PermissionRequest): PermissionUpdate | null {
  return (
    req.permission_suggestions.find((s) => s.type === "addRules" && s.behavior === "allow") ?? null
  );
}

function describeRule(rule: PermissionUpdate): string {
  return (rule.rules ?? [])
    .map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))
    .join(", ");
}

export interface PermissionCardProps {
  req: PermissionRequest;
  /** Decision in flight for this card — disables every button. */
  disabled?: boolean;
  /** Error text from a failed decision POST. */
  error?: string;
  onDecide: (
    id: string,
    behavior: PermissionBehavior,
    updatedPermissions?: PermissionUpdate[]
  ) => void;
  /** Show the project · session line. Off when the page already identifies the session. */
  context?: boolean;
  className?: string;
}

export function PermissionCard({
  req,
  disabled,
  error,
  onDecide,
  context = true,
  className = "",
}: PermissionCardProps) {
  const { t } = useTranslation("common");
  const secondsLeft = Math.max(
    0,
    Math.round((new Date(req.expires_at).getTime() - Date.now()) / 1000)
  );
  const always = allowAlwaysRule(req);
  const summary = summarisePermissionInput(req.tool_name, req.tool_input);

  return (
    <div className={className}>
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-100">
            {t("permissions.wants", { tool: req.tool_name })}
          </div>
          {context && (
            <div className="truncate text-xs text-gray-500" title={req.cwd ?? undefined}>
              {projectOf(req.cwd)}
              {req.session_id ? ` · ${req.session_id.slice(0, 8)}` : ""}
            </div>
          )}
        </div>
        <span className="text-xs tabular-nums text-gray-500">
          {t("permissions.expiresIn", { seconds: secondsLeft })}
        </span>
      </div>

      {/* Whole input, unabridged — the user is approving exactly this — but
          shaped per tool instead of dumped as one JSON blob. */}
      <div className="mt-3 max-h-80 overflow-auto">
        <PermissionInputView fields={summary.fields} />
      </div>

      {always && (
        <div className="mt-2 text-xs text-gray-500">
          {t("permissions.alwaysRule", {
            rule: describeRule(always),
            destination: always.destination ?? "session",
          })}
        </div>
      )}
      {error && (
        <div className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary !py-1.5 text-xs"
          disabled={disabled}
          onClick={() => onDecide(req.id, "allow")}
        >
          {t("permissions.allow")}
        </button>
        {always && (
          <button
            type="button"
            className="btn-ghost border border-border text-xs"
            disabled={disabled}
            title={`${describeRule(always)} → ${always.destination ?? "session"}`}
            onClick={() => onDecide(req.id, "allow", [always])}
          >
            {t("permissions.allowAlways")}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost border border-red-500/40 text-xs text-red-300 hover:bg-red-500/10"
          disabled={disabled}
          onClick={() => onDecide(req.id, "deny")}
        >
          {t("permissions.deny")}
        </button>
        <button
          type="button"
          className="btn-ghost ml-auto text-xs"
          disabled={disabled}
          onClick={() => onDecide(req.id, "defer")}
        >
          {t("permissions.inTerminal")}
        </button>
      </div>
    </div>
  );
}
