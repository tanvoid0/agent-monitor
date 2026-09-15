/**
 * @file Plan discovery (docs/plan-layer.md §4.2): every distinct sessions.cwd
 * seen in the last 7 days is checked for a PROGRESS.md; present → upsert a
 * `plans` row (importing a legacy `.local/log.md` once, on first sight) and
 * watch the file; changed → re-parse and broadcast `plan_updated`. fs.watch
 * per file with a 2 s stat poll as the fallback, the pattern of
 * server/lib/cc-watcher.js. Everything here is best-effort and never throws
 * into a request.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const { db } = require("../db");
// Module object, not destructured, so tests can observe the broadcast.
const ws = require("../websocket");
const { parsePlan, parseLog } = require("./parser");

const SEEN_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_MS = 2000;
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const q = {
  recentCwds: db.prepare(
    `SELECT DISTINCT cwd FROM sessions
     WHERE cwd IS NOT NULL AND cwd != '' AND COALESCE(NULLIF(updated_at, ''), started_at) >= ?`
  ),
  get: db.prepare("SELECT * FROM plans WHERE cwd = ?"),
  bySlug: db.prepare("SELECT * FROM plans WHERE slug = ?"),
  all: db.prepare("SELECT * FROM plans ORDER BY slug"),
  slugTaken: db.prepare("SELECT 1 FROM plans WHERE slug = ?"),
  insert: db.prepare(
    "INSERT INTO plans (cwd, slug, source, parsed, step, mtime) VALUES (?, ?, ?, ?, ?, ?)"
  ),
  // step_since only moves when the step number changes
  update: db.prepare(
    `UPDATE plans SET source = ?, parsed = ?, step = ?,
       step_since = CASE WHEN step IS ? THEN step_since ELSE ${NOW_SQL} END,
       mtime = ?, updated_at = ${NOW_SQL}
     WHERE cwd = ?`
  ),
  insertLog: db.prepare(
    "INSERT INTO plan_log (cwd, step, key, agent, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ),
};

const watchers = new Map(); // cwd -> fs.FSWatcher
let timer = null;

function progressPath(cwd) {
  return path.join(cwd, "PROGRESS.md");
}

function statKey(file) {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

// basename of cwd; parent-basename on collision; a counter after that.
function slugFor(cwd) {
  const base = path.basename(cwd) || cwd;
  for (const c of [base, `${path.basename(path.dirname(cwd))}-${base}`]) {
    if (!q.slugTaken.get(c)) return c;
  }
  for (let i = 2; ; i++) if (!q.slugTaken.get(`${base}-${i}`)) return `${base}-${i}`;
}

function isoOr(ts, fallback) {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

// One-time import of the retired per-repo log file, same grammar. Lines under
// `## step N` keep their step; anything else (the sandbox section) joins the
// step current at import time.
function importLog(cwd, currentStep) {
  let md;
  try {
    md = fs.readFileSync(path.join(cwd, ".local", "log.md"), "utf8");
  } catch {
    return 0;
  }
  const rows = parseLog(md);
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const r of rows) {
      const m = /^step (\d+)$/.exec(r.section);
      const step = m ? parseInt(m[1], 10) : currentStep || 0;
      q.insertLog.run(cwd, step, r.key, r.agent, r.status, r.note || null, isoOr(r.ts, now));
    }
  });
  tx();
  return rows.length;
}

function watchFile(cwd) {
  if (watchers.has(cwd)) return;
  try {
    const w = fs.watch(progressPath(cwd), () => {
      try {
        refresh(cwd);
      } catch {
        /* a half-written file; the next change or poll re-reads it */
      }
    });
    w.on("error", () => {});
    if (w.unref) w.unref();
    watchers.set(cwd, w);
  } catch {
    /* the 2 s stat poll still covers this plan */
  }
}

/**
 * Re-read <cwd>/PROGRESS.md when it changed on disk (or `force`), upsert the
 * plans row and broadcast `plan_updated`. Returns the row, or null when there
 * is no PROGRESS.md.
 */
function refresh(rawCwd, force = false) {
  const cwd = path.resolve(rawCwd);
  const file = progressPath(cwd);
  const key = statKey(file);
  if (!key) return null;
  const existing = q.get.get(cwd);
  if (existing && existing.mtime === key && !force) return existing;
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    return existing || null;
  }
  const parsed = parsePlan(source);
  const step = parsed.steps.current;
  if (existing) {
    q.update.run(source, JSON.stringify(parsed), step, step, key, cwd);
  } else {
    q.insert.run(cwd, slugFor(cwd), source, JSON.stringify(parsed), step, key);
    importLog(cwd, step);
  }
  watchFile(cwd);
  const row = q.get.get(cwd);
  ws.broadcast("plan_updated", { slug: row.slug });
  return row;
}

/** Discovery + stat poll over every known plan. `nowMs` is injectable for tests. */
function scan(nowMs = Date.now()) {
  const since = new Date(nowMs - SEEN_MS).toISOString();
  const seen = new Set(q.all.all().map((p) => p.cwd));
  for (const { cwd } of q.recentCwds.all(since)) seen.add(path.resolve(cwd));
  for (const cwd of seen) {
    try {
      refresh(cwd);
    } catch {
      /* one bad plan file must not stop the others */
    }
  }
}

function start() {
  if (timer) return;
  scan();
  timer = setInterval(scan, POLL_MS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const w of watchers.values()) w.close();
  watchers.clear();
}

module.exports = {
  start,
  stop,
  scan,
  refresh,
  importLog,
  list: () => q.all.all(),
  get: (cwd) => q.get.get(path.resolve(cwd)),
  bySlug: (slug) => q.bySlug.get(slug),
};
