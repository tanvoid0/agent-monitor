/**
 * @file server/plan/join.js + tail.js + text.js against the seeded ledgerflow
 * fixture: `summary` at the fixture's `now` must equal expected/summary.txt
 * byte for byte; per-agent transcript figures for the live agent; the pure
 * helpers (lane from a prompt, log-label matching, tool fields).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TEST_DB = path.join(os.tmpdir(), `plan-join-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;

const dbModule = require("../db");
const { seed } = require("../../test/fixtures/plan/seed");
const watcher = require("../plan/watcher");
const join = require("../plan/join");
const text = require("../plan/text");
const { figures } = require("../plan/tail");
const { transcriptCache } = require("../routes/hooks");
const { FIXTURE_DIR, NOW, readExpected, makeProject, removeProject } = require("./plan-fixture");

let cwd;
let plan;
let model;

before(() => {
  cwd = makeProject("ledgerflow");
  seed(dbModule, { fixtureDir: FIXTURE_DIR, cwd, now: NOW });
  watcher.scan(Date.parse(NOW));
  plan = watcher.get(cwd);
  model = join.model(plan, { now: new Date(NOW), transcriptCache });
});

after(() => {
  watcher.stop();
  dbModule.db.close();
  removeProject(cwd);
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe("plan join — ledgerflow fixture", () => {
  it("summary equals expected/summary.txt", () => {
    assert.equal(text.summary(model), readExpected("summary.txt").replace(/\r\n/g, "\n").trimEnd());
  });

  it("model shape: project, counts, lanes, live agent, totals", () => {
    const expected = JSON.parse(readExpected("model.json"));
    assert.deepEqual(model.project, { slug: "ledgerflow", cwd: path.resolve(cwd), step: 17 });
    assert.equal(model.now, NOW);
    assert.deepEqual(model.status, expected.status);
    assert.deepEqual(model.steps, expected.steps);
    const step = model.stories[0];
    assert.deepEqual(step.counts, expected.stories[0].counts);
    assert.deepEqual(
      step.lanes.map((l) => [l.letter, l.counts, l.live]),
      expected.stories[0].lanes.map((l) => [l.letter, l.counts, l.live])
    );
    const live = model.agents["af01d6844fb0e1968"];
    assert.equal(live.live, true);
    assert.equal(live.lane, "D");
    assert.equal(live.box, "D3");
    assert.equal(live.tools, 106);
    assert.equal(live.errors, 3);
    assert.equal(live.model, "claude-sonnet-5");
    assert.equal(live.ctxPct, 81);
    assert.equal(live.out, 3736);
    assert.ok(live.cost > 0, "cost from tokensByModel × model_pricing");
    assert.ok(live.say && live.say.length <= 300);
    assert.equal(Object.keys(model.agents).length, expected.totals.agents);
    for (const k of ["live", "tools", "errors", "sessions"]) {
      assert.deepEqual(model.totals[k], expected.totals[k], `totals.${k}`);
    }
    // D1 status/agent/log come from the imported log lines
    const d1 = step.lanes[0].tasks[0];
    assert.equal(d1.status, "done");
    assert.equal(d1.agent, "D");
    assert.equal(d1.agentId, "af01d6844fb0e1968");
    assert.equal(d1.log.length, 3);
    assert.equal(step.lanes[2].tasks[2].status, "doing"); // I3: note line, unticked
  });

  it("events in the v2 line shape carry the CCAM agent id", () => {
    const lines = join.eventLines(plan, { limit: 50 });
    assert.equal(lines.length, 50);
    const last = lines[lines.length - 1];
    assert.equal(last.ev, "tool.pre");
    assert.equal(last.agentId, "af01d6844fb0e1968");
    assert.equal(last.tool, "Bash");
    assert.match(last.cmd, /^cd "D:\/projects\/practice\/microservices\/ledgerflow" && bash -n/);
  });

  it("tail figures for the live agent's transcript", () => {
    const meta = JSON.parse(dbModule.stmts.getAgent.get("af01d6844fb0e1968").metadata);
    const f = figures(meta.transcript_path, { transcriptCache });
    assert.equal(f.model, "claude-sonnet-5");
    assert.equal(f.out, 3736);
    assert.equal(f.window, 200000);
    assert.equal(f.ctxPct, 81);
    assert.ok(f.calls > 0);
    assert.equal(figures(path.join(FIXTURE_DIR, "nope.jsonl"), {}), null);
  });
});

describe("plan join — helpers", () => {
  it("laneOf reads `Lane X — title` off a prompt", () => {
    assert.deepEqual(join.laneOf("Lane D — Demo · serial\nrest"), {
      lane: "D",
      title: "Demo · serial",
    });
    assert.deepEqual(join.laneOf("Lane I"), { lane: "I", title: "" });
    assert.equal(join.laneOf("Please review lane A"), null);
  });

  it("labelMatches: type, lane, id, claude id and its suffix, main", () => {
    const a = { id: "ccam-1", claudeId: "a41bd1302af678ba7", type: "crew:coder", lane: "I" };
    for (const l of ["crew:coder", "I", "ccam-1", "a41bd1302af678ba7", "78ba7"]) {
      assert.ok(join.labelMatches(l, a), l);
    }
    assert.equal(join.labelMatches("main", a), false);
    assert.ok(join.labelMatches("main", { id: "s-main", claudeId: null, type: "main", lane: "C" }));
    // without a claude id the suffix is the CCAM id's
    assert.ok(
      join.labelMatches("e1968", { id: "af01d6844fb0e1968", claudeId: null, type: "x", lane: null })
    );
  });

  it("toolFields: what the call was about, files relative to the project", () => {
    const root = path.resolve("/proj");
    assert.deepEqual(join.toolFields("Bash", { command: "ls", description: "list" }, root), {
      cmd: "ls",
      desc: "list",
    });
    assert.deepEqual(join.toolFields("Read", { file_path: path.join(root, "a", "b.js") }, root), {
      file: "a/b.js",
    });
    assert.deepEqual(join.toolFields("Grep", { pattern: "x", path: "src" }, root), {
      pattern: "x",
      file: "src",
    });
    assert.deepEqual(join.toolFields("Agent", { description: "Lane D: demo" }, root), {
      desc: "Lane D: demo",
    });
  });
});
