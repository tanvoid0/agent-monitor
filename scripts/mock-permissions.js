#!/usr/bin/env node

/**
 * Fires fake Claude Code `PermissionRequest` hook payloads at a running
 * dashboard so the permission relay UI can be exercised without a live CLI.
 * Each prompt blocks exactly like the real http hook and prints the decision
 * the dashboard answered with (allow / deny / defer / timeout).
 *
 *   node scripts/mock-permissions.js                 one prompt of each kind
 *   node scripts/mock-permissions.js --count 3       three rounds
 *   DASHBOARD_PORT=4820 DASHBOARD_TOKEN=... also honored
 *
 * The dashboard must have a browser tab open — with no WebSocket client the
 * relay answers `{}` immediately (falls through to the terminal prompt).
 *
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const port = process.env.DASHBOARD_PORT || "4820";
const base = `http://127.0.0.1:${port}`;
const count = parseInt(process.argv[process.argv.indexOf("--count") + 1], 10) || 1;

const PROMPTS = [
  { tool_name: "Bash", tool_input: { command: "npm publish", description: "Publish package" } },
  {
    tool_name: "Edit",
    tool_input: { file_path: "src/index.ts", old_string: "foo", new_string: "bar" },
  },
  { tool_name: "Write", tool_input: { file_path: "README.md", content: "# hello\n" } },
  { tool_name: "WebFetch", tool_input: { url: "https://example.com", prompt: "summarize" } },
];

async function fire(prompt, i) {
  const body = {
    hook_event_name: "PermissionRequest",
    session_id: `mock-perm-${String(i).padStart(4, "0")}`,
    cwd: process.cwd(),
    permission_mode: "default",
    permission_suggestions: [
      { type: "addRules", rules: [{ toolName: prompt.tool_name }], behavior: "allow", destination: "session" },
    ],
    ...prompt,
  };
  const headers = { "content-type": "application/json" };
  if (process.env.DASHBOARD_TOKEN) headers.authorization = `Bearer ${process.env.DASHBOARD_TOKEN}`;
  const t0 = Date.now();
  const res = await fetch(`${base}/api/hooks/permission-request`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  const decision = json.hookSpecificOutput?.decision;
  const outcome = decision ? decision.behavior : "no decision (defer/timeout/no UI)";
  console.log(
    `[${i}] ${prompt.tool_name.padEnd(8)} → ${outcome}` +
      (decision?.message ? ` — "${decision.message}"` : "") +
      (decision?.updatedPermissions ? ` +${decision.updatedPermissions.length} rule(s)` : "") +
      ` (${Date.now() - t0}ms, HTTP ${res.status})`,
  );
}

(async () => {
  let i = 0;
  for (let round = 0; round < count; round++) {
    // Sequential: mirrors Claude Code, which blocks on one prompt at a time.
    for (const p of PROMPTS) await fire(p, ++i);
  }
})().catch((err) => {
  console.error(`dashboard unreachable at ${base}: ${err.message}`);
  process.exit(1);
});
