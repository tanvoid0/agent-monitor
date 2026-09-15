/**
 * @file Floating panel that lets the user answer Claude Code permission
 * prompts from the dashboard. Prompts arrive as `permission_request`
 * WebSocket pushes (and via GET /api/permissions on mount and on every
 * reconnect so a reload or server restart does not strand a card); Allow /
 * Allow always / Deny / "answer in terminal" POST a decision that unblocks
 * the CLI. Each card shows the complete tool input — the user is granting a
 * real tool call — and counts down to the relay's hold deadline, after which
 * Claude Code falls back to its own terminal prompt.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import type { PermissionRequest, PermissionResolvedPayload, PermissionUpdate } from "../lib/types";

function projectOf(cwd: string | null): string {
  return cwd ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd) : "";
}

/** The allow rule Claude Code suggested for this prompt, if any — what "Allow always" writes. */
function allowAlwaysRule(req: PermissionRequest): PermissionUpdate | null {
  return (
    req.permission_suggestions.find((s) => s.type === "addRules" && s.behavior === "allow") ?? null
  );
}

function describeRule(rule: PermissionUpdate): string {
  return (rule.rules ?? [])
    .map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName))
    .join(", ");
}

export function PermissionRelay() {
  const { t } = useTranslation("common");
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);

  useEffect(() => {
    const refetch = () =>
      api.permissions
        .list()
        .then((r) => setPending(r.pending))
        .catch(() => {});
    refetch();
    const unsubMessages = eventBus.subscribe((msg) => {
      if (msg.type === "permission_request") {
        const req = msg.data as PermissionRequest;
        setPending((prev) => (prev.some((p) => p.id === req.id) ? prev : [...prev, req]));
      } else if (msg.type === "permission_resolved") {
        const { id } = msg.data as PermissionResolvedPayload;
        setPending((prev) => prev.filter((p) => p.id !== id));
      }
    });
    // A server restart drops the in-memory queue without a resolved push.
    const unsubConnection = eventBus.onConnection((connected) => {
      if (connected) refetch();
    });
    return () => {
      unsubMessages();
      unsubConnection();
    };
  }, []);

  // Drive the countdown only while something is on screen.
  useEffect(() => {
    if (!pending.length) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [pending.length]);

  const decide = useCallback(
    async (
      id: string,
      behavior: "allow" | "deny" | "defer",
      updatedPermissions?: PermissionUpdate[]
    ) => {
      setBusy(id);
      try {
        await api.permissions.decide(id, { behavior, updatedPermissions });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/no pending permission/i.test(message)) {
          // Already answered, expired, or dropped by a restart — nothing to do.
          setPending((prev) => prev.filter((p) => p.id !== id));
        } else {
          setErrors((prev) => ({ ...prev, [id]: message }));
        }
      } finally {
        setBusy(null);
      }
    },
    []
  );

  if (!pending.length) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-[80] flex w-[min(30rem,calc(100vw-2.5rem))] flex-col gap-3"
      role="region"
      aria-label={t("permissions.title")}
    >
      {pending.map((req) => {
        const secondsLeft = Math.max(
          0,
          Math.round((new Date(req.expires_at).getTime() - Date.now()) / 1000)
        );
        const always = allowAlwaysRule(req);
        const disabled = busy === req.id;
        return (
          <div
            key={req.id}
            className="card border-amber-500/40 bg-surface-3/95 p-4 shadow-2xl backdrop-blur animate-fade-in"
          >
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-100">
                  {t("permissions.wants", { tool: req.tool_name })}
                </div>
                <div className="truncate text-xs text-gray-500" title={req.cwd ?? undefined}>
                  {projectOf(req.cwd)}
                  {req.session_id ? ` · ${req.session_id.slice(0, 8)}` : ""}
                </div>
              </div>
              <span className="text-xs tabular-nums text-gray-500">
                {t("permissions.expiresIn", { seconds: secondsLeft })}
              </span>
            </div>
            {/* Whole input, unabridged: the user is approving exactly this. */}
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-border bg-surface-1 p-2 text-xs text-gray-300 whitespace-pre-wrap break-all">
              {JSON.stringify(req.tool_input, null, 2)}
            </pre>
            {always && (
              <div className="mt-2 text-xs text-gray-500">
                {t("permissions.alwaysRule", {
                  rule: describeRule(always),
                  destination: always.destination ?? "session",
                })}
              </div>
            )}
            {errors[req.id] && (
              <div className="mt-2 text-xs text-red-400" role="alert">
                {errors[req.id]}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary !py-1.5 text-xs"
                disabled={disabled}
                onClick={() => decide(req.id, "allow")}
              >
                {t("permissions.allow")}
              </button>
              {always && (
                <button
                  type="button"
                  className="btn-ghost border border-border text-xs"
                  disabled={disabled}
                  title={`${describeRule(always)} → ${always.destination ?? "session"}`}
                  onClick={() => decide(req.id, "allow", [always])}
                >
                  {t("permissions.allowAlways")}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost border border-red-500/40 text-xs text-red-300 hover:bg-red-500/10"
                disabled={disabled}
                onClick={() => decide(req.id, "deny")}
              >
                {t("permissions.deny")}
              </button>
              <button
                type="button"
                className="btn-ghost ml-auto text-xs"
                disabled={disabled}
                onClick={() => decide(req.id, "defer")}
              >
                {t("permissions.inTerminal")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
