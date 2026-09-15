/**
 * @file Smoke test for test/fixtures/plan/seed.js — seeds the ledgerflow plan
 * fixture's v2 events.jsonl into a temp DB and asserts the row counts and one
 * agent's derived lane task + transcript metadata (docs/plan-layer.md §5,
 * Lane D box D1). Not a join/route test — server/plan/**'s own tests (Lane S)
 * cover the read side.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Set up the test database BEFORE requiring server/db, same pattern as
// server/__tests__/api.test.js.
const TEST_DB = path.join(os.tmpdir(), `dashboard-plan-seed-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const dbModule = require("../db");
const { seed } = require("../../test/fixtures/plan/seed");

const FIXTURE_DIR = path.join(__dirname, "..", "..", "test", "fixtures", "plan", "ledgerflow");
const CWD = "D:/projects/practice/microservices/ledgerflow";

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("test/fixtures/plan/seed.js against the ledgerflow fixture", () => {
  let counts;

  before(() => {
    const now = fs.readFileSync(path.join(FIXTURE_DIR, "now.txt"), "utf8").trim();
    counts = seed(dbModule, { fixtureDir: FIXTURE_DIR, cwd: CWD, now });
  });

  it("inserts the fixture's sessions, agents and events", () => {
    // Exact counts from the fixture's events.jsonl (906 lines, 4 selftest
    // lines skipped, 30 agent.start/agent.stop pairs folded into agent rows
    // instead of events rows).
    assert.equal(counts.sessions, 4);
    assert.equal(counts.agents, 36); // 4 main rows + 32 distinct subagents
    assert.equal(counts.events, 858); // tool.pre + tool.post lines only

    const { db } = dbModule;
    assert.equal(db.prepare("SELECT COUNT(*) c FROM sessions").get().c, 4);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM agents").get().c, 36);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM events").get().c, 858);
  });

  it("is idempotent — a second pass over the same file inserts nothing new", () => {
    const now = fs.readFileSync(path.join(FIXTURE_DIR, "now.txt"), "utf8").trim();
    const again = seed(dbModule, { fixtureDir: FIXTURE_DIR, cwd: CWD, now });
    assert.deepEqual(again, { sessions: 0, agents: 0, events: 0 });
  });

  it("derives a Lane D task and an existing transcript path for agent af01d6844fb0e1968", () => {
    const { stmts } = dbModule;
    const agent = stmts.getAgent.get("af01d6844fb0e1968");
    assert.ok(agent, "expected agent af01d6844fb0e1968 to be seeded");
    assert.match(agent.task, /^Lane D/);

    const meta = JSON.parse(agent.metadata);
    assert.ok(meta.transcript_path, "expected metadata.transcript_path to be set");
    assert.ok(
      fs.existsSync(meta.transcript_path),
      `expected transcript file to exist: ${meta.transcript_path}`
    );
  });
});
