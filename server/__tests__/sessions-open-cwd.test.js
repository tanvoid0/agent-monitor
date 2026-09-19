/**
 * @file sessions-open-cwd.test.js
 * @description Tests for `POST /api/sessions/open-cwd`: only an absolute cwd
 * known from a local session that still exists as a directory reaches the
 * file-manager opener; cross-origin browsers are refused; the opener itself is
 * swapped out so no real window is spawned.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const { after, before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const TEST_DB = path.join(os.tmpdir(), `am-sessions-open-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_REMOTE_SYNC_MS = "0";
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");
const sessionsRoute = require("../routes/sessions");

let server;
let baseUrl;
const opened = [];
const KNOWN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "am-open-cwd-"));
const MISSING_DIR = path.join(KNOWN_DIR, "gone");

function post(body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/sessions/open-cwd", baseUrl);
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
      }
    );
    request.on("error", reject);
    request.end(payload);
  });
}

before(async () => {
  sessionsRoute.__setOpenDirectory((dir) => opened.push(dir));
  const app = createApp();
  server = await startServer(app, 0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  stmts.insertSession.run("s-known", "s-known", "active", KNOWN_DIR, "claude-sonnet-4", null);
  stmts.insertSession.run("s-gone", "s-gone", "active", MISSING_DIR, "claude-sonnet-4", null);
  stmts.insertSession.run("s-remote", "s-remote", "active", os.tmpdir(), "claude-sonnet-4", null);
  db.prepare("UPDATE sessions SET source = 'peer-1' WHERE id = 's-remote'").run();
});

after(() => {
  server?.close();
  try {
    db.close();
  } catch {
    // Already closed by a failed test setup.
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      // The database sidecar may not be created in every SQLite mode.
    }
  }
  fs.rmSync(KNOWN_DIR, { recursive: true, force: true });
});

describe("POST /api/sessions/open-cwd", () => {
  it("opens a directory known from a local session", async () => {
    const response = await post({ cwd: KNOWN_DIR });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true, cwd: KNOWN_DIR });
    assert.deepEqual(opened, [KNOWN_DIR]);
  });

  it("rejects a relative or missing cwd", async () => {
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ cwd: "relative/path" })).status, 400);
  });

  it("refuses a cwd no local session knows", async () => {
    const response = await post({ cwd: path.join(os.tmpdir(), "never-seen") });
    assert.equal(response.status, 404);
  });

  it("refuses a known cwd that is no longer a directory", async () => {
    assert.equal((await post({ cwd: MISSING_DIR })).status, 404);
  });

  it("refuses a cwd only a remote source knows", async () => {
    assert.equal((await post({ cwd: os.tmpdir() })).status, 404);
  });

  it("answers 500 when the file manager cannot be launched", async () => {
    sessionsRoute.__setOpenDirectory(() => Promise.reject(new Error("spawn xdg-open ENOENT")));
    const response = await post({ cwd: KNOWN_DIR });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "OPEN_FAILED");
    sessionsRoute.__setOpenDirectory((dir) => opened.push(dir));
  });

  it("refuses cross-origin browser requests", async () => {
    const response = await post({ cwd: KNOWN_DIR }, { Origin: "http://attacker.example" });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "EBADORIGIN");
    assert.equal(opened.length, 1);
  });
});
