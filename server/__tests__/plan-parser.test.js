/**
 * @file server/plan/parser.js against the ledgerflow fixture (structure,
 * per-lane counts, milestones) and an inline sample for what the fixture
 * lacks: a sandbox story with depth-3 nesting, plus the tick transform.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const { parsePlan, parseLog, walk, tick } = require("../plan/parser");

const FIXTURE_DIR = path.join(__dirname, "..", "..", "test", "fixtures", "plan", "ledgerflow");
const MD = fs.readFileSync(path.join(FIXTURE_DIR, "PROGRESS.md"), "utf8");
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "expected", "model.json")));

describe("parsePlan — ledgerflow fixture", () => {
  const plan = parsePlan(MD);

  it("status, steps and milestones match v2's model", () => {
    assert.deepEqual(plan.status, EXPECTED.status);
    assert.deepEqual(plan.steps, EXPECTED.steps);
    assert.deepEqual(plan.milestones, EXPECTED.milestones);
  });

  it("one step story with the lanes, tasks and counts of the fixture", () => {
    assert.equal(plan.stories.length, 1);
    const s = plan.stories[0];
    const e = EXPECTED.stories[0];
    assert.equal(s.id, "step-17");
    assert.equal(s.kind, "step");
    assert.equal(s.title, e.title);
    assert.equal(s.doneWhen, e.doneWhen);
    assert.equal(s.decisions, e.decisions);
    assert.deepEqual(
      s.lanes.map((l) => [l.letter, l.name, l.tags, l.mode, l.touches, [...walk(l.tasks)].length]),
      e.lanes.map((l) => [l.letter, l.name, l.tags, l.mode, l.touches, l.counts.total])
    );
    for (const [i, lane] of s.lanes.entries()) {
      assert.deepEqual(
        [...walk(lane.tasks)].map((t) => [t.key, t.text, t.depth, t.ticked]),
        [...walk(e.lanes[i].tasks)].map((t) => [t.key, t.text, t.depth, t.ticked])
      );
    }
  });
});

const SAMPLE = `**Status (2026-09-15):** 1 / 2 steps done · step 2 in progress (1 / 4 boxes).

## Milestones

### M1 — One ✅
- [x] 01 First (\`3237c3a\`)

### M2 — Two
- [ ] 02 Second — **current**

## Current step: 2 — Second

Done when: the boxes
are ticked.

Decisions:
- none

### Lane R — risk · parallel · one agent
_touches: \`a/**\`_
- [x] R1 done box
- [ ] R2 parent
  - [ ] R2.1 child
    - [ ] R2.1.1 grandchild

## Sandbox: Dry run

Done when: proven.

### Lane X — Dry run · optional · main
- [ ] X1 top

## Next up
`;

describe("parsePlan — nesting, sandbox, log, tick", () => {
  const plan = parsePlan(SAMPLE);

  it("nests by two spaces per level to any depth", () => {
    const lane = plan.stories[0].lanes[0];
    const keys = [...walk(lane.tasks)].map((t) => `${t.key}@${t.depth}`);
    assert.deepEqual(keys, ["R1@0", "R2@0", "R2.1@1", "R2.1.1@2"]);
    assert.equal(lane.tasks[1].children[0].children[0].key, "R2.1.1");
  });

  it("parses the sandbox as a second story after the step", () => {
    assert.deepEqual(
      plan.stories.map((s) => [s.id, s.kind, s.num]),
      [
        ["step-2", "step", 2],
        ["sandbox-1", "sandbox", null],
      ]
    );
    assert.equal(plan.stories[0].doneWhen, "the boxes are ticked.");
    assert.equal(plan.stories[0].decisions, "Decisions:\n- none");
    assert.equal(plan.stories[1].title, "Dry run");
    assert.equal(plan.stories[1].lanes[0].mode, "optional");
    assert.equal(plan.milestones[0].steps[0].commit, "3237c3a");
    assert.deepEqual(plan.steps, { done: 1, total: 2, current: 2 });
  });

  it("parseLog keeps the section and the five fields", () => {
    const rows = parseLog(fs.readFileSync(path.join(FIXTURE_DIR, "log.md"), "utf8"));
    assert.equal(rows.filter((r) => r.section === "step 16").length, 13);
    assert.equal(rows.filter((r) => r.section === "step 17").length, 37);
    const last = rows[rows.length - 1];
    assert.deepEqual(last, {
      section: "step 17",
      ts: "2026-09-15T13:42:37Z",
      agent: "main",
      key: "I3",
      status: "note",
      note: "CI on 28cfc8a failed: ./mvnw Permission denied (mode 100644 from Windows); +x set on mvnw + 8 scripts, pushed f2bef6f, CI rerunning",
    });
  });

  it("tick flips the first matching key at any indent and rewrites the boxes figure", () => {
    const out = tick(SAMPLE, "R2.1.1", true);
    assert.match(out, /^    - \[x\] R2\.1\.1 grandchild$/m);
    assert.match(out, /\(2 \/ 4 boxes\)/);
    const back = tick(out, "R2.1.1", false);
    assert.equal(back, SAMPLE);
    assert.equal(tick(SAMPLE, "Z9", true), null);
  });
});
