/**
 * @file Per-agent transcript figures for the plan join (docs/plan-layer.md
 * §4.4): the v2 tailer — model, API calls, output tokens, current context and
 * its window, the last thing the agent said — read incrementally from the
 * agent's JSONL, plus `cost` from Agent Monitor's own transcript cache × model_pricing
 * so the plan page and the Analytics page agree to the cent.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const fs = require("fs");
const { stmts } = require("../db");
const { calculateCost } = require("../routes/pricing");

const CTX_WINDOW = 200_000;
// The model id does not say which window it runs; anything seen above 200k is
// the 1M variant.
const windowFor = (seenMax) => (seenMax > CTX_WINDOW ? 1_000_000 : CTX_WINDOW);

// path -> { offset, size, seen: Set<message.id>, st }
const tails = new Map();

function readFrom(file, offset) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size < offset) return { chunk: null, size, reset: true };
    if (size === offset) return { chunk: "", size };
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    return { chunk: buf, size };
  } finally {
    fs.closeSync(fd);
  }
}

function fresh() {
  return {
    offset: 0,
    seen: new Set(),
    st: { model: null, calls: 0, out: 0, ctx: 0, max: 0, say: null, lastTs: null },
  };
}

// v2 dedupe: the FIRST record of a message.id counts (Agent Monitor's cache takes the
// last — see transcript-cache.js; the plan figures keep v2's numbers so the
// fixture text reproduces). `say` comes from the latest record, whose text is
// the most complete.
function consume(t, line) {
  if (!line.includes('"assistant"')) return;
  let x;
  try {
    x = JSON.parse(line);
  } catch {
    return;
  }
  if (x.type !== "assistant") return;
  const m = x.message || {};
  if (Array.isArray(m.content)) {
    const text = m.content.filter((c) => c && c.type === "text" && c.text).pop();
    if (text) t.st.say = text.text.replace(/\s+/g, " ").trim().slice(0, 300);
  }
  const u = m.usage;
  if (!u || t.seen.has(m.id)) return;
  t.seen.add(m.id);
  t.st.model = m.model || t.st.model;
  t.st.calls += 1;
  t.st.out += u.output_tokens || 0;
  t.st.ctx =
    (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  t.st.max = Math.max(t.st.max, t.st.ctx);
  t.st.lastTs = x.timestamp || t.st.lastTs;
}

/** v2 stats for one transcript, or null when it cannot be read. */
function tail(file) {
  let t = tails.get(file) || fresh();
  let r;
  try {
    r = readFrom(file, t.offset);
  } catch {
    return tails.has(file) ? t.st : null;
  }
  if (r.reset) {
    t = fresh();
    r = readFrom(file, 0);
  }
  if (r.chunk && r.chunk.length) {
    const nl = r.chunk.lastIndexOf(0x0a);
    if (nl !== -1) {
      for (const line of r.chunk
        .subarray(0, nl + 1)
        .toString("utf8")
        .split("\n"))
        consume(t, line);
      t.offset += nl + 1;
    }
  }
  tails.set(file, t);
  return t.st;
}

function tokenRows(tokensByModel) {
  return Object.values(tokensByModel || {})
    .filter((b) => b && b.model)
    .map((b) => ({
      model: b.model,
      speed: b.speed,
      inference_geo: b.geo,
      service_tier: b.tier,
      input_tokens: b.input || 0,
      output_tokens: b.output || 0,
      cache_read_tokens: b.cacheRead || 0,
      cache_write_tokens: b.cacheWrite || 0,
      cache_write_1h_tokens: b.cacheWrite1h || 0,
      web_search_requests: b.webSearch || 0,
      web_fetch_requests: b.webFetch || 0,
      code_execution_requests: b.codeExec || 0,
    }));
}

/**
 * Figures for one agent transcript: { model, calls, out, ctx, window, ctxPct,
 * say, cost }, or null when the file is unreadable. `transcriptCache` is the
 * hooks router's shared instance; `pricing` the model_pricing rows (read once
 * per model build); `asOf` the agent's start date for intro-rate cutovers.
 */
function figures(file, { transcriptCache, pricing = stmts.listPricing.all(), asOf } = {}) {
  const st = tail(file);
  if (!st) return null;
  let cost = 0;
  if (transcriptCache) {
    try {
      const rows = tokenRows(transcriptCache.extract(file)?.tokensByModel);
      if (rows.length) cost = calculateCost(rows, pricing, asOf).total_cost;
    } catch {
      /* unpriced is $0, as on the Analytics page */
    }
  }
  const window = windowFor(st.max);
  return {
    model: st.model,
    calls: st.calls,
    out: st.out,
    ctx: st.ctx,
    window,
    ctxPct: Math.round((100 * st.ctx) / window),
    say: st.say,
    cost,
  };
}

module.exports = { figures, tail, windowFor };
