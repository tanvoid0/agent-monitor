/**
 * @file server/plan/watcher.js — discovery from sessions.cwd, the one-time
 * .local/log.md import, slug collisions, re-parse on change with
 * `plan_updated`, and the 7-day window.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_DB = path.join(os.tmpdir(), `plan-watcher-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const dbModule = require("../db");
const ws = require("../websocket");
const watcher = require("../plan/watcher");
const { NOW, makeProject, removeProject } = require("./plan-fixture");

const { db, stmts } = dbModule;
const nowMs = Date.parse(NOW);
const sent = [];
const realBroadcast = ws.broadcast;
ws.broadcast = (type, data) => sent.push({ type, data });

let cwd;
let twin;

function session(id, sessionCwd, startedAt) {
  stmts.insertSession.run(id, null, "active", sessionCwd, null, null);
  db.prepare("UPDATE sessions SET started_at = ?, updated_at = ? WHERE id = ?").run(
    startedAt,
    startedAt,
    id
  );
}

before(() => {
  cwd = makeProject("ledgerflow");
  twin = makeProject("ledgerflow"); // same basename, different parent
  session("s1", cwd, NOW);
  session("s2", twin, NOW);
  // an old session pointing at a plan that must NOT be discovered
  const stale = makeProject("stale");
  session("s3", stale, new Date(nowMs - 8 * 24 * 3600 * 1000).toISOString());
});

after(() => {
  watcher.stop();
  ws.broadcast = realBroadcast;
  db.close();
  removeProject(cwd);
  removeProject(twin);
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe("plan watcher", () => {
  it("discovers plans from recent sessions.cwd and imports .local/log.md once", () => {
    watcher.scan(nowMs);
    const plans = watcher.list();
    assert.deepEqual(
      plans.map((p) => [p.slug, p.step]),
      [
        ["ledgerflow", 17],
        [`${path.basename(path.dirname(twin))}-ledgerflow`, 17],
      ]
    );
    const plan = watcher.get(cwd);
    assert.equal(plan.cwd, path.resolve(cwd));
    assert.equal(JSON.parse(plan.parsed).stories[0].id, "step-17");
    const log = db
      .prepare("SELECT step, COUNT(*) n FROM plan_log WHERE cwd = ? GROUP BY step ORDER BY step")
      .all(plan.cwd);
    assert.deepEqual(log, [
      { step: 16, n: 13 },
      { step: 17, n: 37 },
    ]);
    assert.equal(
      db.prepare("SELECT created_at FROM plan_log WHERE cwd = ? ORDER BY id LIMIT 1").get(plan.cwd)
        .created_at,
      "2026-09-15T12:33:57.000Z",
      "log line timestamps are kept, normalised to ms precision"
    );
    assert.deepEqual(
      sent.filter((m) => m.type === "plan_updated").map((m) => m.data.slug),
      plans.map((p) => p.slug)
    );

    // A second scan changes nothing and imports nothing twice.
    sent.length = 0;
    watcher.scan(nowMs);
    assert.equal(sent.length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM plan_log").get().n, 100);
  });

  it("re-parses on change, moves step_since only when the step changes", () => {
    const plan = watcher.get(cwd);
    const file = path.join(cwd, "PROGRESS.md");
    const md = fs
      .readFileSync(file, "utf8")
      .replace("- [ ] D4 clean-clone", "- [x] D4 clean-clone");
    fs.writeFileSync(file, md);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000)); // beat coarse mtime
    sent.length = 0;
    watcher.scan(nowMs);
    const again = watcher.get(cwd);
    assert.notEqual(again.mtime, plan.mtime);
    assert.equal(again.step_since, plan.step_since, "same step → same window start");
    const d4 = JSON.parse(again.parsed).stories[0].lanes[0].tasks[3];
    assert.equal(d4.key, "D4");
    assert.equal(d4.ticked, true);
    assert.deepEqual(sent, [{ type: "plan_updated", data: { slug: "ledgerflow" } }]);

    // the step number is the **current** marker under Milestones (v2 rule)
    fs.writeFileSync(
      file,
      md
        .replace(
          "17 The repository someone actually reads — **current**",
          "17 The repository someone actually reads"
        )
        .replace(
          "- [ ] 18 Partitions decide everything",
          "- [ ] 18 Partitions decide everything — **current**"
        )
    );
    fs.utimesSync(file, new Date(), new Date(Date.now() + 10000));
    watcher.scan(nowMs);
    const moved = watcher.get(cwd);
    assert.equal(moved.step, 18);
    assert.notEqual(moved.step_since, plan.step_since);
  });

  it("a cwd without PROGRESS.md is left alone", () => {
    assert.equal(watcher.refresh(os.tmpdir()), null);
  });
});
