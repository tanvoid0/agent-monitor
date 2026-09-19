/**
 * @file Permission relay — lets the dashboard answer Claude Code permission
 * prompts. Claude Code's `PermissionRequest` hook (installed as an `http`
 * hook) POSTs here and blocks until we respond; we park the response, push
 * the request to the UI over the WebSocket, and reply with a decision once a
 * user clicks Allow / Deny. If nobody answers within the hold window we
 * reply with an empty body, which Claude Code treats as "no decision" and
 * falls through to its normal terminal prompt — so a dashboard nobody is
 * looking at never blocks the CLI for long, and a dashboard that is down is
 * a connection failure Claude Code ignores.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const { randomUUID } = require("node:crypto");
const { broadcast, getConnectionCount } = require("../websocket");

// How long to hold a prompt for the dashboard before falling through to the
// terminal. The installed hook's own timeout is set above this so Claude Code
// never cancels us first.
const HOLD_MS = (() => {
  const raw = parseInt(process.env.DASHBOARD_PERMISSION_HOLD_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();

// ponytail: in-memory only; a restart drops pending prompts (they fall back
// to the terminal via connection reset), which is the fail-safe we want.
const pending = new Map();

function publicView(entry) {
  const { res: _res, timer: _timer, ...view } = entry;
  return view;
}

function finish(id, outcome, body) {
  const entry = pending.get(id);
  if (!entry) return null;
  pending.delete(id);
  clearTimeout(entry.timer);
  if (!entry.res.writableEnded && !entry.res.destroyed) entry.res.json(body);
  broadcast("permission_resolved", { id, outcome });
  return entry;
}

/** Park a PermissionRequest hook POST until the UI decides or the hold expires. */
function hold(payload, res) {
  // Nobody has the dashboard open → holding would only delay the terminal
  // prompt by HOLD_MS for a headless server. Fall through immediately.
  if (getConnectionCount() === 0) {
    res.json({});
    return null;
  }
  const id = randomUUID();
  const entry = {
    id,
    session_id: payload.session_id || null,
    cwd: payload.cwd || null,
    tool_name: payload.tool_name || "",
    tool_input: payload.tool_input || {},
    permission_mode: payload.permission_mode || null,
    permission_suggestions: Array.isArray(payload.permission_suggestions)
      ? payload.permission_suggestions
      : [],
    received_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + HOLD_MS).toISOString(),
    res,
    timer: setTimeout(() => finish(id, "timeout", {}), HOLD_MS),
  };
  pending.set(id, entry);
  // Hook process died / Claude Code cancelled the hook: nothing to answer.
  res.on("close", () => {
    if (pending.has(id)) finish(id, "cancelled", {});
  });
  broadcast("permission_request", publicView(entry));
  return id;
}

/**
 * Resolve a held prompt. `behavior` is "allow" | "deny" | "defer" — defer
 * answers with no decision so the terminal prompt appears immediately.
 */
function decide(id, { behavior, message, updatedPermissions }) {
  const entry = pending.get(id);
  if (!entry) return false;
  if (behavior === "defer") {
    finish(id, "deferred", {});
    return true;
  }
  const decision = { behavior };
  if (behavior === "allow" && Array.isArray(updatedPermissions) && updatedPermissions.length) {
    // Only echo entries Claude Code itself suggested for this prompt — a
    // dashboard token must not be able to write arbitrary allow rules.
    const offered = new Set(entry.permission_suggestions.map((s) => JSON.stringify(s)));
    const accepted = updatedPermissions.filter((u) => offered.has(JSON.stringify(u)));
    if (accepted.length) decision.updatedPermissions = accepted;
  }
  if (behavior === "deny" && message) decision.message = String(message).slice(0, 2000);
  finish(id, behavior, {
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision },
  });
  return true;
}

function list() {
  return [...pending.values()].map(publicView);
}

/** Test hook: drop every held prompt without answering it. */
function __reset() {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}

module.exports = { hold, decide, list, HOLD_MS, __reset };
