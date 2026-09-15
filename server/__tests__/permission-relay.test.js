/**
 * @file Round-trip test for the permission relay: a PermissionRequest hook
 * POST is parked, shows up in /api/permissions, and is answered by a
 * decision; an unanswered one falls through (empty body) when the hold
 * window expires.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "permission-relay-test-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
process.env.DASHBOARD_PERMISSION_HOLD_MS = "300";

const WebSocket = require("ws");
const { createApp } = require("../index");
const { initWebSocket, closeWebSocket } = require("../websocket");
const relay = require("../lib/permission-relay");

let server;
let BASE;
let wsClient;

// The relay only holds a prompt while someone has the dashboard open, so
// most tests need one live WebSocket client.
function connectClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace("http", "ws") + "/ws");
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function fetchJson(pathname, { method = "GET", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      u,
      {
        method,
        headers: {
          ...(payload ? { "content-type": "application/json" } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null })
        );
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const HOOK_PAYLOAD = {
  session_id: "sess-1",
  cwd: "/tmp/proj",
  permission_mode: "default",
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: { command: "rm -rf node_modules" },
  permission_suggestions: [
    {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "rm -rf node_modules" }],
      behavior: "allow",
      destination: "localSettings",
    },
  ],
};

async function waitForPending() {
  for (let i = 0; i < 50; i++) {
    const { body } = await fetchJson("/api/permissions");
    if (body.pending.length) return body.pending;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("hook POST never showed up in /api/permissions");
}

describe("permission relay", () => {
  before(async () => {
    server = http.createServer(createApp());
    initWebSocket(server);
    await new Promise((r) => server.listen(0, r));
    BASE = `http://127.0.0.1:${server.address().port}`;
    wsClient = await connectClient();
  });

  after(async () => {
    wsClient.close();
    closeWebSocket();
    await new Promise((r) => server.close(r));
    try {
      fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best-effort temp cleanup */
    }
  });

  beforeEach(() => relay.__reset());

  it("rejects payloads that are not PermissionRequest hooks", async () => {
    const { status } = await fetchJson("/api/hooks/permission-request", {
      method: "POST",
      body: { hook_event_name: "PreToolUse", tool_name: "Bash" },
    });
    assert.equal(status, 400);
  });

  it("parks the hook until the UI allows it, echoing a suggested rule", async () => {
    const hook = fetchJson("/api/hooks/permission-request", {
      method: "POST",
      body: HOOK_PAYLOAD,
    });
    const [pending] = await waitForPending();
    assert.equal(pending.tool_name, "Bash");
    assert.equal(pending.session_id, "sess-1");
    assert.equal(pending.res, undefined, "held response must not leak into the listing");

    const decided = await fetchJson(`/api/permissions/${pending.id}/decision`, {
      method: "POST",
      body: { behavior: "allow", updatedPermissions: HOOK_PAYLOAD.permission_suggestions },
    });
    assert.equal(decided.status, 200);

    const { status, body } = await hook;
    assert.equal(status, 200);
    assert.deepEqual(body, {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow", updatedPermissions: HOOK_PAYLOAD.permission_suggestions },
      },
    });
    assert.deepEqual((await fetchJson("/api/permissions")).body.pending, []);
  });

  it("drops updatedPermissions Claude Code did not suggest", async () => {
    const hook = fetchJson("/api/hooks/permission-request", {
      method: "POST",
      body: HOOK_PAYLOAD,
    });
    const [pending] = await waitForPending();
    await fetchJson(`/api/permissions/${pending.id}/decision`, {
      method: "POST",
      body: {
        behavior: "allow",
        updatedPermissions: [
          {
            type: "addRules",
            rules: [{ toolName: "Bash" }],
            behavior: "allow",
            destination: "userSettings",
          },
        ],
      },
    });
    const { body } = await hook;
    assert.deepEqual(body.hookSpecificOutput.decision, { behavior: "allow" });
  });

  it("falls through immediately when no dashboard client is connected", async () => {
    wsClient.close();
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    const { status, body } = await fetchJson("/api/hooks/permission-request", {
      method: "POST",
      body: HOOK_PAYLOAD,
    });
    assert.equal(status, 200);
    assert.deepEqual(body, {});
    assert.ok(Date.now() - t0 < 200, "must not hold with nobody listening");
    wsClient = await connectClient();
  });

  it("denies with a message", async () => {
    const hook = fetchJson("/api/hooks/permission-request", {
      method: "POST",
      body: HOOK_PAYLOAD,
    });
    const [pending] = await waitForPending();
    await fetchJson(`/api/permissions/${pending.id}/decision`, {
      method: "POST",
      body: { behavior: "deny", message: "not on prod" },
    });
    const { body } = await hook;
    assert.deepEqual(body.hookSpecificOutput.decision, {
      behavior: "deny",
      message: "not on prod",
    });
  });

  it("falls through with an empty body when nobody answers in time", async () => {
    const t0 = Date.now();
    const { status, body } = await fetchJson("/api/hooks/permission-request", {
      method: "POST",
      body: HOOK_PAYLOAD,
    });
    assert.equal(status, 200);
    assert.deepEqual(body, {});
    assert.ok(Date.now() - t0 >= 250, "should have held for the configured window");
  });

  it("404s a decision for an unknown or already-answered id", async () => {
    const { status } = await fetchJson("/api/permissions/nope/decision", {
      method: "POST",
      body: { behavior: "allow" },
    });
    assert.equal(status, 404);
  });

  it("refuses cross-origin decisions", async () => {
    const { status } = await fetchJson("/api/permissions/x/decision", {
      method: "POST",
      body: { behavior: "allow" },
      headers: { origin: "https://evil.example" },
    });
    assert.equal(status, 403);
  });
});
