/**
 * @file Plan discovery (docs/plan-layer.md §4.2): every distinct sessions.cwd
 * seen in the last 7 days is checked for a PROGRESS.md; present → upsert a
 * `plans` row and watch the file; changed → re-parse and broadcast
 * `plan_updated`; gone for 10 s → drop the row. The retired `.local/log.md`
 * beside it is imported whenever it changes (only lines not already present),
 * so a project still appending to it through the v2 board stays in step.
 * fs.watch per file with a 2 s stat poll as the fallback, the pattern of
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
// An editor's rename-style save leaves the file missing for a moment; only a
// sustained absence retires the plan (and, by cascade, its log).
const GONE_MS = 10_000;
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
  getLog: db.prepare("SELECT * FROM plan_log WHERE id = ?"),
  logExists: db.prepare(
    `SELECT 1 FROM plan_log
     WHERE cwd = ? AND step = ? AND key = ? AND agent = ? AND status = ? AND created_at = ?
       AND COALESCE(note, '') = ? LIMIT 1`
  ),
};

const watchers = new Map(); // "<cwd>" | "<cwd>|log" -> fs.FSWatcher
const logKeys = new Map(); // cwd -> stat key of .local/log.md at last import
const missingSince = new Map(); // cwd -> ms when PROGRESS.md was first found missing
let timer = null;

const progressPath = (cwd) => path.join(cwd, "PROGRESS.md");
const logPath = (cwd) => path.join(cwd, ".local", "log.md");

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

function watch(key, file, onChange) {
  if (watchers.has(key)) return;
  try {
    const w = fs.watch(file, () => {
      try {
        onChange();
      } catch {
        /* a half-written file; the next change or poll re-reads it */
      }
    });
    w.on("error", () => {});
    if (w.unref) w.unref();
    watchers.set(key, w);
  } catch {
    /* the 2 s stat poll still covers this file */
  }
}

function unwatch(cwd) {
  for (const key of [cwd, `${cwd}|log`]) {
    const w = watchers.get(key);
    if (w) w.close();
    watchers.delete(key);
  }
}

/**
 * Import the retired per-repo log file when it changed since the last
 * import: same grammar, lines under `## step N` keep their step, anything
 * else joins the current step. Only lines not already stored are inserted
 * (matched on step, key, agent, status, timestamp and note), so a restart or
 * the v2 board appending beside us never duplicates. Returns the new rows.
 */
function importLog(cwd, currentStep) {
  const file = logPath(cwd);
  const key = statKey(file);
  if (!key || logKeys.get(cwd) === key) return [];
  let md;
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  logKeys.set(cwd, key);
  const inserted = [];
  const tx = db.transaction(() => {
    for (const r of parseLog(md)) {
      const tsMs = Date.parse(r.ts);
      if (!Number.isFinite(tsMs)) continue;
      const ts = new Date(tsMs).toISOString();
      const m = /^step (\d+)$/.exec(r.section);
      const step = m ? parseInt(m[1], 10) : currentStep || 0;
      const note = r.note || null;
      if (q.logExists.get(cwd, step, r.key, r.agent, r.status, ts, note || "")) continue;
      const info = q.insertLog.run(cwd, step, r.key, r.agent, r.status, note, ts);
      inserted.push(q.getLog.get(info.lastInsertRowid));
    }
  });
  tx();
  watch(`${cwd}|log`, file, () => refresh(cwd));
  return inserted;
}

// PROGRESS.md has been gone long enough: the project moved, dropped its plan,
// or a branch without one is checked out. The watchers close; the row and its
// log stay — history outlives the file, a checkout must not erase it — and the
// routes keep serving the last parse until the file returns (the poll finds it
// again and `refresh` re-arms the watchers).
function forget(cwd, existing, nowMs) {
  const first = missingSince.get(cwd) || nowMs;
  missingSince.set(cwd, first);
  if (nowMs - first < GONE_MS || !watchers.has(cwd)) return;
  unwatch(cwd);
  logKeys.delete(cwd);
  ws.broadcast("plan_updated", { slug: existing.slug });
}

/**
 * Re-read <cwd>/PROGRESS.md when it changed on disk (or `force`), upsert the
 * plans row and broadcast `plan_updated`; then import any new `.local/log.md`
 * lines. Returns the row, or null when there is no PROGRESS.md.
 */
function refresh(rawCwd, force = false, nowMs = Date.now()) {
  const cwd = path.resolve(rawCwd);
  const file = progressPath(cwd);
  const key = statKey(file);
  const existing = q.get.get(cwd);
  if (!key) {
    if (existing) forget(cwd, existing, nowMs);
    return null;
  }
  missingSince.delete(cwd);
  let row = existing;
  if (!existing || existing.mtime !== key || force) {
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      return existing || null;
    }
    const parsed = parsePlan(source);
    const step = parsed.steps.current;
    // Claude Code's Write truncates then writes: a parse that lost the current
    // step while the stored plan has one is a half-written file. Keep the
    // stored row; the next change or poll re-reads the finished file.
    // Ceiling: a plan that really dropped its current step is re-read every
    // poll until it names one again.
    const halfWritten = existing && step == null && existing.step != null;
    if (!halfWritten) {
      if (existing) q.update.run(source, JSON.stringify(parsed), step, step, key, cwd);
      else q.insert.run(cwd, slugFor(cwd), source, JSON.stringify(parsed), step, key);
      row = q.get.get(cwd);
      ws.broadcast("plan_updated", { slug: row.slug });
    }
    watch(cwd, file, () => refresh(cwd));
  }
  for (const r of importLog(cwd, row.step)) ws.broadcast("plan_log", { slug: row.slug, row: r });
  return row;
}

/** Discovery + stat poll over every known plan. `nowMs` is injectable for tests. */
function scan(nowMs = Date.now()) {
  const since = new Date(nowMs - SEEN_MS).toISOString();
  const seen = new Set(q.all.all().map((p) => p.cwd));
  for (const { cwd } of q.recentCwds.all(since)) seen.add(path.resolve(cwd));
  for (const cwd of seen) {
    try {
      refresh(cwd, false, nowMs);
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
  logKeys.clear();
  missingSince.clear();
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
