/**
 * @file Shared setup for the plan-layer tests: a throwaway project directory
 * built from test/fixtures/plan/ledgerflow (PROGRESS.md at the root, the v2
 * log as .local/log.md — the layout the watcher reads) plus the fixture's
 * `now`. Not a test file; required by plan-*.test.js.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const FIXTURE_DIR = path.join(__dirname, "..", "..", "test", "fixtures", "plan", "ledgerflow");
const NOW = fs.readFileSync(path.join(FIXTURE_DIR, "now.txt"), "utf8").trim();

function readExpected(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, "expected", name), "utf8");
}

/** Copy the fixture plan into `<tmp>/<name>/`; returns the project cwd. */
function makeProject(name = "ledgerflow") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-fixture-"));
  const cwd = path.join(root, name);
  fs.mkdirSync(path.join(cwd, ".local"), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE_DIR, "PROGRESS.md"), path.join(cwd, "PROGRESS.md"));
  fs.copyFileSync(path.join(FIXTURE_DIR, "log.md"), path.join(cwd, ".local", "log.md"));
  return cwd;
}

function removeProject(cwd) {
  try {
    fs.rmSync(path.dirname(cwd), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

module.exports = { FIXTURE_DIR, NOW, readExpected, makeProject, removeProject };
