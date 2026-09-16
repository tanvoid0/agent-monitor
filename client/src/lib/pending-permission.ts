/**
 * @file pending-permission.ts
 * @description Reconstructs *what* a waiting session is asking permission for
 * from its hook events alone — for prompts the relay is no longer holding
 * (hold window passed, dashboard was closed when it fired, or the
 * PermissionRequest hook is not installed). Claude Code emits, in order, a
 * `PreToolUse` carrying the exact tool input and then a `Notification` of type
 * `permission_prompt`; while the user has not answered, no `PostToolUse`,
 * `UserPromptSubmit` or `Stop` follows. That pairing is enough to show the
 * tool and its input, read-only, beside an "answer in the terminal" note.
 *
 * Pure: takes the newest-first event list the session endpoint returns.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { DashboardEvent } from "./types";

export interface InferredPermission {
  tool_name: string;
  tool_input: Record<string, unknown>;
  /** The notification's own wording, e.g. "Claude needs your permission to use Bash". */
  message: string | null;
  /** ISO timestamp of the permission notification. */
  asked_at: string;
}

/** Any of these arriving after the notification means the prompt was answered. */
const RESOLVING_TYPES = new Set(["PostToolUse", "UserPromptSubmit", "Stop", "SessionEnd"]);

function parseData(e: DashboardEvent): Record<string, unknown> | null {
  const raw: unknown = e.data;
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isPermissionNotification(e: DashboardEvent, data: Record<string, unknown> | null) {
  if (e.event_type !== "Notification" || !data) return false;
  if (data.notification_type === "permission_prompt") return true;
  return typeof data.message === "string" && /\bpermission\b/i.test(data.message);
}

/**
 * The permission prompt a session is currently blocked on, or null when the
 * events do not show an unanswered one. `events` must be newest first.
 */
export function inferPendingPermission(
  events: ReadonlyArray<DashboardEvent>
): InferredPermission | null {
  // Walk from newest: anything that resolves a prompt before we meet the
  // notification means there is no open prompt.
  let notifIndex = -1;
  let message: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e) continue;
    if (RESOLVING_TYPES.has(e.event_type) || e.event_type === "PreToolUse") return null;
    const data = parseData(e);
    if (isPermissionNotification(e, data)) {
      notifIndex = i;
      message = typeof data?.message === "string" ? data.message : null;
      break;
    }
  }
  if (notifIndex < 0) return null;

  // The PreToolUse immediately older than the notification is the blocked call.
  for (let i = notifIndex + 1; i < events.length; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.event_type === "PreToolUse") {
      const data = parseData(e);
      const toolName = e.tool_name ?? (typeof data?.tool_name === "string" ? data.tool_name : null);
      if (!toolName) return null;
      const input = data?.tool_input;
      return {
        tool_name: toolName,
        tool_input: input && typeof input === "object" ? (input as Record<string, unknown>) : {},
        message,
        asked_at: events[notifIndex]?.created_at ?? e.created_at,
      };
    }
    // A completed tool or a turn boundary older than the notification but with
    // no PreToolUse in between: the notification was not about a tool call
    // (e.g. an AskUserQuestion-style input request) — nothing to reconstruct.
    if (RESOLVING_TYPES.has(e.event_type)) return null;
  }
  return null;
}
