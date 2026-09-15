/**
 * @file WebSocket push for the plan page (docs/plan-layer.md §4.5):
 * `plan_model {slug, model}` when a plan's inputs changed — at most every
 * 300 ms — and at least every 5 s while any agent on the plan is working
 * (ages and transcripts move without a row changing). A 250 ms poll over the
 * cheap version string, the v2 stream loop; nothing runs while no websocket
 * client is connected.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const ws = require("../websocket");
const watcher = require("./watcher");
const join = require("./join");

const POLL_MS = 250;
const DEBOUNCE_MS = 300;
const TICK_MS = 5000;

const state = new Map(); // slug -> { version, dirty, sentAt, live }
let timer = null;
let transcriptCache = null;

function poll(now = Date.now()) {
  if (ws.getConnectionCount() === 0) return 0;
  let sent = 0;
  for (const plan of watcher.list()) {
    const s = state.get(plan.slug) || { version: null, dirty: true, sentAt: 0, live: false };
    state.set(plan.slug, s);
    const v = join.version(plan);
    if (v !== s.version) {
      s.version = v;
      s.dirty = true;
    }
    const due = (s.dirty && now - s.sentAt >= DEBOUNCE_MS) || (s.live && now - s.sentAt >= TICK_MS);
    if (!due) continue;
    let model;
    try {
      model = join.model(plan, { transcriptCache });
    } catch {
      continue; // a half-written plan file; next poll
    }
    ws.broadcast("plan_model", { slug: plan.slug, model });
    s.sentAt = now;
    s.dirty = false;
    s.live = model.totals.live > 0;
    sent += 1;
  }
  return sent;
}

function start(opts = {}) {
  transcriptCache = opts.transcriptCache || null;
  if (timer) return;
  timer = setInterval(poll, POLL_MS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  state.clear();
}

module.exports = { start, stop, poll };
