/**
 * @file Plan-layer tables (docs/plan-layer.md §4.2): one `plans` row per
 * project directory whose PROGRESS.md the watcher found, and `plan_log` for
 * the box-level start/done/blocked/note lines agents post. Created from one
 * call in server/db.js; every statement is IF NOT EXISTS so it is safe on
 * every start.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      cwd        TEXT PRIMARY KEY,
      slug       TEXT NOT NULL UNIQUE,
      source     TEXT NOT NULL,
      parsed     TEXT NOT NULL,
      step       INTEGER,
      -- when the current step number was first seen; the step's event window
      -- opens at the earlier of this and its first plan_log line
      step_since TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      mtime      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS plan_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      cwd        TEXT NOT NULL REFERENCES plans(cwd) ON DELETE CASCADE,
      step       INTEGER NOT NULL,
      key        TEXT NOT NULL,
      agent      TEXT NOT NULL,
      status     TEXT NOT NULL CHECK(status IN ('start','done','blocked','note')),
      note       TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_plan_log_cwd_step ON plan_log(cwd, step);
  `);
}

module.exports = { init };
