/**
 * @file /api/plans (docs/plan-layer.md §4.5) over HTTP against the seeded
 * ledgerflow fixture: every route, `wip` line-for-line against
 * expected/wip.txt (after stripping the `$` and `say:` additions), tick and
 * log round trips, export's three files, the websocket pusher's debounce and
 * 5 s tick, and a live scenario driven through the hook route — a `Lane X —`
 * subagent whose box turns `doing` with the right agent.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `plan-routes-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const dbModule = require("../db");
const ws = require("../websocket");
const { createApp, startServer } = require("../index");
const { seed } = require("../../test/fixtures/plan/seed");
const watcher = require("../plan/watcher");
const push = require("../plan/push");
const { FIXTURE_DIR, NOW, readExpected, makeProject, removeProject } = require("./plan-fixture");

let server;
let BASE;
let cwd;
let liveSlug;
const sent = [];
const realBroadcast = ws.broadcast;
const realCount = ws.getConnectionCount;

function fetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: { "Content-Type": "application/json", ...options.headers },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let parsed = body;
          if (/json/.test(res.headers["content-type"] || "")) {
            try {
              parsed = JSON.parse(body);
            } catch {
              /* keep text */
            }
          }
          resolve({ status: res.statusCode, body: parsed, type: res.headers["content-type"] });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}
const post = (p, body) => fetch(p, { method: "POST", body });
const at = (p) => `${p}${p.includes("?") ? "&" : "?"}now=${encodeURIComponent(NOW)}`;
const expected = (name) => readExpected(name).replace(/\r\n/g, "\n").trimEnd();
// wip adds `$` to the agent tag and a `say:` line under each live agent
const stripAdditions = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s+say: /.test(l))
    .map((l) => l.replace(/, \$\d+\.\d\d\)/, ")"))
    .join("\n");

before(async () => {
  ws.broadcast = (type, data) => {
    sent.push({ type, data });
    realBroadcast(type, data);
  };
  cwd = makeProject("ledgerflow");
  seed(dbModule, { fixtureDir: FIXTURE_DIR, cwd, now: NOW });
  server = await startServer(createApp(), 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
  watcher.scan(Date.parse(NOW));
});

after(() => {
  ws.broadcast = realBroadcast;
  ws.getConnectionCount = realCount;
  push.stop();
  watcher.stop();
  if (server) server.close();
  removeProject(cwd);
});

describe("GET /api/plans", () => {
  it("lists the project with counts and live agents; ?format=text one line each", async () => {
    const r = await fetch(at("/api/plans"));
    assert.equal(r.status, 200);
    const p = r.body.plans.find((x) => x.slug === "ledgerflow");
    assert.equal(p.step, 17);
    assert.equal(p.cwd, path.resolve(cwd));
    assert.deepEqual(p.live, ["af01d6844fb0e1968"]);
    assert.equal(p.counts.total, 19);
    assert.equal(p.lastTs, "2026-09-15T14:09:01.033Z");
    const t = await fetch(at("/api/plans?format=text"));
    assert.match(t.type, /text\/plain/);
    assert.match(
      t.body,
      /^ledgerflow · step 17 The repository someone actually reads · 12\/19 done, 1 doing, 0 blocked · live 1 · last event /m
    );
  });
});

describe("text routes", () => {
  it("summary equals expected/summary.txt; ?format=json gives the data", async () => {
    const r = await fetch(at("/api/plans/ledgerflow/summary"));
    assert.match(r.type, /text\/plain/);
    assert.equal(r.body, expected("summary.txt"));
    const j = await fetch(at("/api/plans/ledgerflow/summary?format=json"));
    assert.equal(j.body.project.slug, "ledgerflow");
    assert.equal(j.body.stories[0].lanes[0].live, "af01d6844fb0e1968");
  });

  it("wip equals expected/wip.txt once the $ and say additions are stripped", async () => {
    const r = await fetch(at("/api/plans/ledgerflow/wip"));
    assert.equal(stripAdditions(r.body), expected("wip.txt"));
    assert.match(r.body.split("\n")[0], /\(sonnet 5, ctx 81%, \$\d+\.\d\d\)/, "the $ figure");
    const j = await fetch(at("/api/plans/ledgerflow/wip?format=json"));
    assert.equal(j.body.length, 1);
    assert.equal(j.body[0].id, "af01d6844fb0e1968");
  });

  it("model, next, lane, task, agent", async () => {
    const m = (await fetch(at("/api/plans/ledgerflow/model"))).body;
    assert.equal(m.now, NOW);
    assert.equal(m.project.step, 17);
    assert.equal(m.totals.live, 1);

    const n = (await fetch(at("/api/plans/ledgerflow/next?n=2"))).body;
    const lines = n.split("\n");
    assert.match(lines[0], /^step 17 — done when: A clean clone/);
    assert.match(lines[1], /^lane D Demo \(serial\) touches `scripts\/demo.sh`/);
    assert.match(lines[2], /^  D4 clean-clone proof/);
    assert.match(lines[3], /^  D5 `scripts\/walkthrough.sh`/);
    assert.match(lines[4], /^lane W Walkthrough \(optional\)/);

    const lane = (await fetch(at("/api/plans/ledgerflow/lane/D"))).body.split("\n");
    assert.equal(lane[0], "lane D Demo · serial · one agent");
    assert.match(lane[2], /^3\/6 done · live: crew:coder@e1968 \(sonnet 5, ctx 81%\)$/);
    assert.match(
      lane[3],
      /^\[x\] D1 `scripts\/start-services.sh`.* · D \(sonnet 5\) · 13:40:54 · 0s · \d+ tools, 3 errors$/
    );
    assert.match(lane[6], /^\[t\] D4 /);
    assert.equal((await fetch(at("/api/plans/ledgerflow/lane/Z"))).status, 404);

    const task = (await fetch(at("/api/plans/ledgerflow/task/I2"))).body.split("\n");
    assert.equal(task[0], "step 17 › lane I › I2");
    assert.equal(task[1], "status: done");
    assert.match(task[3], /^agent: I · crew:coder@78ba7 \(sonnet 5, ctx \d+%\)$/);
    assert.match(
      task[4],
      /^started: 13:23:08 · finished: 13:38:23 · 15m 15s · \d+ tools, 1 errors$/
    );
    assert.ok(task.includes("tool events:"));
    assert.equal((await fetch(at("/api/plans/ledgerflow/task/Q9"))).status, 404);

    const agent = (await fetch(at("/api/plans/ledgerflow/agent/e1968"))).body.split("\n");
    assert.match(
      agent[0],
      /^crew:coder@e1968 \(sonnet 5, ctx 81%, \$\d+\.\d\d\) · session 1ee316a7 · live$/
    );
    assert.equal(agent[1], "lane D  · box D3 · started 13:43:06 (25m ago)");
    assert.match(
      agent[2],
      /^model claude-sonnet-5 · \d+ calls · 3736 tokens out · ctx \d+ \(81%\) · \$\d+\.\d\d$/
    );
    assert.match(agent[3], /^106 tools · 3 errors · last: cd /);
    assert.equal((await fetch(at("/api/plans/ledgerflow/agent/zzzzz"))).status, 404);
    assert.equal((await fetch(at("/api/plans/nope/summary"))).status, 404);
  });
});

describe("POST tick / log / export", () => {
  it("tick flips the box in PROGRESS.md, rewrites the figure, answers with the summary", async () => {
    const r = await post(at("/api/plans/ledgerflow/tick"), { key: "D4", done: true });
    assert.equal(r.status, 200);
    assert.match(r.body, /\(13 \/ 19 boxes\)/);
    assert.match(r.body, /lane D Demo · serial · 4\/6/);
    assert.match(r.body, /^next: D5, W1, C3$/m);
    const md = fs.readFileSync(path.join(cwd, "PROGRESS.md"), "utf8");
    assert.match(md, /^- \[x\] D4 clean-clone proof/m);
    assert.match(md, /step 17 in progress \(13 \/ 19 boxes\)/);
    // back
    const back = await post(at("/api/plans/ledgerflow/tick?format=json"), {
      key: "D4",
      done: false,
    });
    assert.equal(back.body.counts.done, 12);
    assert.equal((await post("/api/plans/ledgerflow/tick", { key: "Z9" })).status, 404);
    assert.equal((await post("/api/plans/ledgerflow/tick", {})).status, 400);
  });

  it("log inserts a plan_log row for the current step and broadcasts plan_log", async () => {
    sent.length = 0;
    const r = await post("/api/plans/ledgerflow/log", {
      agent: "D",
      key: "D5",
      status: "start",
      note: "walkthrough.sh",
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.row.step, 17);
    assert.equal(r.body.row.key, "D5");
    const msg = sent.find((m) => m.type === "plan_log");
    assert.deepEqual(msg.data, { slug: "ledgerflow", row: r.body.row });
    // D5 is now doing, by the live lane-D agent
    const m = (await fetch(at("/api/plans/ledgerflow/model"))).body;
    const d5 = m.stories[0].lanes[0].tasks[4];
    assert.equal(d5.status, "doing");
    assert.equal(d5.agentId, "af01d6844fb0e1968");
    assert.equal(m.agents["af01d6844fb0e1968"].box, "D5");
    assert.equal(
      (await post("/api/plans/ledgerflow/log", { agent: "D", key: "D5", status: "nope" })).status,
      400
    );
    assert.equal(
      (await post("/api/plans/ledgerflow/log", { key: "D5", status: "done" })).status,
      400
    );
  });

  it("export writes index.html, model.json, events.jsonl and answers the Artifact call", async () => {
    const dir = path.join(path.dirname(cwd), "out");
    const r = await post(at("/api/plans/ledgerflow/export"), { dir });
    assert.equal(r.status, 200);
    assert.match(
      r.body,
      /^Artifact\(file_path=".*\/out\/index.html", files=\{"model.json": ".*\/out\/model.json", "events.jsonl": \{"from": ".*\/out\/events.jsonl", "contentType": "text\/plain"\}\}\)$/
    );
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    assert.match(html, /<title>ledgerflow · build board<\/title>/);
    assert.match(html, /loadSnapshot\(\)/);
    const model = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8"));
    assert.equal(model.project.slug, "ledgerflow");
    const lines = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 858);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.ev, "tool.pre");
    assert.equal(last.agent, "af01d6844fb0e1968");
    assert.ok(model.agents[last.agent], "events key into model.agents the way the v2 page does");
    assert.equal((await post("/api/plans/ledgerflow/export", { dir: "relative" })).status, 400);
  });
});

describe("live: hooks → plan", () => {
  it("a `Lane X —` subagent's box goes doing with the right agent; a permission prompt shows WAITING", async () => {
    // a second project, driven only through the hook route
    const live = makeProject("liveproj");
    const sid = "live-sess-1";
    const hook = (hook_type, data) =>
      post("/api/hooks/event", { hook_type, data: { session_id: sid, cwd: live, ...data } });
    await hook("SessionStart", {});
    await hook("UserPromptSubmit", { prompt: "go" });
    await hook("PreToolUse", {
      tool_name: "Agent",
      tool_input: {
        subagent_type: "crew:coder",
        description: "Lane D",
        prompt: "Lane D — Demo\nDo D4.",
      },
    });
    await hook("SubagentStart", { agent_id: "live-d-1", agent_type: "crew:coder" });
    await hook("PreToolUse", {
      agent_id: "live-d-1",
      tool_name: "Bash",
      tool_input: { command: "bash scripts/demo.sh" },
    });
    watcher.scan();
    const slug = watcher.get(live).slug;
    liveSlug = slug;
    await post(`/api/plans/${slug}/log`, {
      agent: "crew:coder",
      key: "D4",
      status: "start",
      note: "clean clone",
    });

    let m = (await fetch(`/api/plans/${slug}/model`)).body;
    const laneD = m.stories[0].lanes[0];
    const sub = Object.values(m.agents).find((a) => a.claudeId === "live-d-1");
    assert.ok(sub, "the bound subagent is on the plan");
    assert.equal(sub.lane, "D");
    assert.equal(sub.title, "Demo");
    assert.equal(sub.live, true);
    assert.equal(sub.tools, 1, "its own spawn event is the dispatcher's tool call");
    assert.equal(sub.last, "bash scripts/demo.sh");
    assert.equal(laneD.live, sub.id);
    assert.equal(laneD.tasks[3].status, "doing");
    assert.equal(laneD.tasks[3].agentId, sub.id);
    assert.equal(sub.box, "D4");
    const main = Object.values(m.agents).find((a) => a.type === "main");
    assert.equal(main.lane, "C");
    assert.equal(main.tools, 1, "the Agent dispatch");

    await hook("Notification", {
      agent_id: "live-d-1",
      message: "Claude needs your permission to use Bash",
    });
    m = (await fetch(`/api/plans/${slug}/model`)).body;
    const waiting = Object.values(m.agents).find((a) => a.claudeId === "live-d-1");
    assert.deepEqual(
      { kind: waiting.waiting.kind, tool: waiting.waiting.tool },
      { kind: "permission", tool: "Bash" }
    );
    assert.equal(waiting.live, true);
    assert.equal(m.totals.waiting, 1);
    const summary = (await fetch(`/api/plans/${slug}/summary`)).body;
    assert.match(
      summary,
      /lane D Demo · serial · 3\/6 · live crew:coder@e-d-1 on D4 · WAITING permission Bash · last: bash scripts\/demo.sh/
    );

    await hook("PostToolUse", {
      agent_id: "live-d-1",
      tool_name: "Bash",
      tool_response: { stdout: "ok" },
    });
    m = (await fetch(`/api/plans/${slug}/model`)).body;
    assert.equal(Object.values(m.agents).find((a) => a.claudeId === "live-d-1").waiting, null);
  });
});

describe("websocket pusher", () => {
  it("plan_model on change (≥300 ms apart) and every 5 s while an agent works", async () => {
    ws.getConnectionCount = () => 1;
    push.stop();
    sent.length = 0;
    const mine = () => sent.filter((m) => m.type === "plan_model" && m.data.slug === liveSlug);
    let t = 1_000_000;
    push.poll(t);
    assert.equal(mine().length, 1, "first sight sends");
    assert.ok(mine()[0].data.model.totals.live >= 1, "the hook-driven subagent is live now");
    push.poll(t + 100);
    assert.equal(mine().length, 1, "nothing changed, nothing sent");
    push.touch(liveSlug);
    push.poll(t + 200);
    assert.equal(mine().length, 1, "debounced");
    push.poll((t += 400));
    assert.equal(mine().length, 2, "sent after 300 ms");
    push.poll(t + 4000);
    assert.equal(mine().length, 2);
    push.poll(t + 5000);
    assert.equal(mine().length, 3, "5 s tick while an agent works");
    // an insert bumps the version → sent on the next poll past the debounce
    await post(`/api/plans/${liveSlug}/log`, { agent: "D", key: "D5", status: "note", note: "x" });
    push.poll(t + 5400);
    assert.equal(mine().length, 4);
    ws.getConnectionCount = () => 0;
    assert.equal(push.poll(t + 20000), 0, "no clients, no work");
    ws.getConnectionCount = realCount;
  });
});
