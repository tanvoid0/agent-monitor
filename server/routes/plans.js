/**
 * @file Plan-layer routes (docs/plan-layer.md §4.5), mounted at /api/plans:
 * the project list, the model, the text views a main thread reads (summary,
 * next, wip, lane, task, agent — `?format=json` for the data), `tick` (flips a
 * checkbox in the project's PROGRESS.md), `log` (a plan_log line) and
 * `export` (the v2 snapshot page + model.json + events.jsonl into a caller-
 * named directory). Requiring this module also starts the plan watcher and
 * the websocket pusher.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const { Router } = require("express");
const { db } = require("../db");
const ws = require("../websocket");
const watcher = require("../plan/watcher");
const join = require("../plan/join");
const text = require("../plan/text");
const push = require("../plan/push");
const { tick, walk } = require("../plan/parser");
const { transcriptCache } = require("./hooks");

const router = Router();
const SNAPSHOT = path.join(__dirname, "..", "plan", "snapshot.html");
const LOG_STATUS = new Set(["start", "done", "blocked", "note"]);

const insertLog = db.prepare(
  "INSERT INTO plan_log (cwd, step, key, agent, status, note) VALUES (?, ?, ?, ?, ?, ?)"
);
const getLog = db.prepare("SELECT * FROM plan_log WHERE id = ?");

const bad = (res, message) => res.status(400).json({ error: { code: "INVALID_INPUT", message } });
const notFound = (res, message) => res.status(404).json({ error: { code: "NOT_FOUND", message } });

// Re-read the plan file first so a hand edit is reflected on the next request,
// not only on the next 2 s poll.
function planOf(req, res) {
  const p = watcher.bySlug(req.params.slug);
  if (!p) {
    notFound(res, "no such plan");
    return null;
  }
  return watcher.refresh(p.cwd) || p;
}

// `?now=<iso>` pins the clock (tests, reproducing a snapshot); otherwise the
// cached model.
function modelOf(req, plan) {
  const now = req.query.now ? new Date(String(req.query.now)) : undefined;
  return join.model(plan, { now: Number.isNaN(now?.getTime()) ? undefined : now, transcriptCache });
}

function send(req, res, body, data) {
  if (body === null || body === undefined) return notFound(res, "not found");
  if (req.query.format === "json") return res.json(data);
  res.type("text/plain; charset=utf-8").send(body);
}

router.get("/", (req, res) => {
  const now = Date.now();
  const rows = watcher.list().map((p) => {
    const m = modelOf(req, p);
    const agents = Object.values(m.agents);
    const step = m.stories.find((s) => s.kind === "step") || null;
    const last = agents.map((a) => Date.parse(a.lastTs)).filter(Boolean);
    const lastTs = last.length ? new Date(Math.max(...last)).toISOString() : null;
    return {
      slug: p.slug,
      cwd: p.cwd,
      step: p.step,
      title: step ? step.title : null,
      counts: step ? step.counts : null,
      live: agents.filter((a) => a.live).map((a) => a.id),
      waiting: agents.filter((a) => a.waiting).length,
      lastTs,
      lastAge: lastTs ? Math.floor((now - Date.parse(lastTs)) / 1000) : null,
    };
  });
  if (req.query.format !== "text") return res.json({ plans: rows });
  const lines = rows.map((r) => {
    const c = r.counts;
    return (
      `${r.slug} · step ${r.step ?? "-"}${r.title ? ` ${r.title}` : ""}` +
      (c ? ` · ${c.done}/${c.total} done, ${c.doing} doing, ${c.blocked} blocked` : " · no lanes") +
      ` · live ${r.live.length}${r.waiting ? ` · waiting ${r.waiting}` : ""}` +
      (r.lastTs ? ` · last event ${text.ago(r.lastTs, now)}` : "")
    );
  });
  res.type("text/plain; charset=utf-8").send(lines.join("\n") || "no plans");
});

router.get("/:slug/model", (req, res) => {
  const plan = planOf(req, res);
  if (plan) res.json(modelOf(req, plan));
});

router.get("/:slug/summary", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const m = modelOf(req, plan);
  send(req, res, text.summary(m), {
    project: m.project,
    status: m.status,
    steps: m.steps,
    totals: m.totals,
    stories: m.stories.map((s) => ({
      id: s.id,
      counts: s.counts,
      lanes: s.lanes.map((l) => ({ letter: l.letter, counts: l.counts, live: l.live })),
    })),
  });
});

router.get("/:slug/next", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const n = Math.max(1, parseInt(req.query.n, 10) || 3);
  const m = modelOf(req, plan);
  send(
    req,
    res,
    text.next(m, n),
    m.stories.flatMap((s) =>
      s.lanes.map((l) => ({
        story: s.id,
        lane: l.letter,
        tasks: [...walk(l.tasks)]
          .filter((t) => t.status === "todo" && !t.children.length)
          .slice(0, n),
      }))
    )
  );
});

router.get("/:slug/wip", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const m = modelOf(req, plan);
  send(
    req,
    res,
    text.wip(m, join.eventLines(plan)),
    Object.values(m.agents).filter((a) => a.live)
  );
});

router.get("/:slug/lane/:letter", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const m = modelOf(req, plan);
  const [, lane] = text.findLane(m, req.params.letter);
  send(req, res, lane ? text.lane(m, req.params.letter) : null, lane);
});

router.get("/:slug/task/:key", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const m = modelOf(req, plan);
  const [, , task] = text.findTask(m, req.params.key);
  send(req, res, task ? text.task(m, req.params.key, join.eventLines(plan)) : null, task);
});

router.get("/:slug/agent/:id", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const m = modelOf(req, plan);
  const agent = text.findAgent(m, req.params.id);
  send(req, res, agent ? text.agent(m, req.params.id, join.eventLines(plan)) : null, agent);
});

// Flip `- [ ] KEY` in <cwd>/PROGRESS.md (first match, any indent), rewrite the
// `(N / M boxes)` figure, re-parse and answer with the summary.
router.post("/:slug/tick", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const { key, done = true } = req.body || {};
  if (typeof key !== "string" || !key.trim() || key.length > 40) return bad(res, "key is required");
  const file = path.join(plan.cwd, "PROGRESS.md");
  let md;
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    return notFound(res, "PROGRESS.md is gone");
  }
  const out = tick(md, key.trim(), !!done);
  if (out === null) return notFound(res, "no such key");
  fs.writeFileSync(file, out);
  const fresh = watcher.refresh(plan.cwd, true) || plan;
  const m = modelOf(req, fresh);
  push.touch(fresh.slug);
  send(req, res, text.summary(m), {
    ok: true,
    key: key.trim(),
    done: !!done,
    counts: m.stories[0]?.counts,
  });
});

// A box-level line for the current step — what agents post instead of
// appending to .local/log.md.
router.post("/:slug/log", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const { agent, key, status, note } = req.body || {};
  const str = (v, n) => typeof v === "string" && v.trim() && v.length <= n;
  if (!str(agent, 200)) return bad(res, "agent is required");
  if (!str(key, 200)) return bad(res, "key is required");
  if (!LOG_STATUS.has(status)) return bad(res, "status must be start, done, blocked or note");
  if (note != null && (typeof note !== "string" || note.length > 4000))
    return bad(res, "note too long");
  const info = insertLog.run(
    plan.cwd,
    plan.step ?? 0,
    key.trim(),
    agent.trim(),
    status,
    note ? note.trim() : null
  );
  const row = getLog.get(info.lastInsertRowid);
  ws.broadcast("plan_log", { slug: plan.slug, row });
  push.touch(plan.slug);
  res.status(201).json({ ok: true, row });
});

// Snapshot into a caller-named directory (the Artifact tool reads only the
// session's cwd/scratchpad). Answers with the Artifact(...) call to publish it.
router.post("/:slug/export", (req, res) => {
  const plan = planOf(req, res);
  if (!plan) return;
  const { dir } = req.body || {};
  if (typeof dir !== "string" || !dir.trim() || !path.isAbsolute(dir)) {
    return bad(res, "dir must be an absolute path");
  }
  const m = modelOf(req, plan);
  const target = path.resolve(dir);
  try {
    fs.mkdirSync(target, { recursive: true });
    const html = fs
      .readFileSync(SNAPSHOT, "utf8")
      .replace(
        "<title>LedgerFlow Build Board</title>",
        `<title>${plan.slug} · build board</title>`
      );
    fs.writeFileSync(path.join(target, "index.html"), html);
    fs.writeFileSync(path.join(target, "model.json"), JSON.stringify(m));
    fs.writeFileSync(
      path.join(target, "events.jsonl"),
      join
        .eventLines(plan)
        .map((l) => JSON.stringify(l))
        .join("\n") + "\n"
    );
  } catch (err) {
    return res.status(500).json({ error: { code: "EXPORT_FAILED", message: err.message } });
  }
  const files = ["index.html", "model.json", "events.jsonl"];
  const p = (f) => path.join(target, f).split(path.sep).join("/");
  const artifact =
    `Artifact(file_path="${p("index.html")}", files={"model.json": "${p("model.json")}", ` +
    `"events.jsonl": {"from": "${p("events.jsonl")}", "contentType": "text/plain"}})`;
  send(req, res, artifact, { ok: true, dir: target, files, artifact });
});

watcher.start();
push.start({ transcriptCache });

module.exports = router;
