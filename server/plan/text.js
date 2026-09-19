/**
 * @file Text views over the plan model (docs/plan-layer.md §4.5): summary,
 * next, wip, lane, task, agent — the lines a main thread reads instead of the
 * files. One fact per line, no tables, hh:mm:ss absolute, `12s ago` / `3m` /
 * `1.2h` relative. A port of the v2 board's text_* functions; `wip` adds the
 * `$` figure, `summary` adds the WAITING chip.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const { walk } = require("./parser");

const ms = (s) => (s ? Date.parse(s) : NaN);

function ago(ts, nowMs) {
  const t = ms(ts);
  if (!t) return "?";
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : `${(s / 3600).toFixed(1)}h ago`;
}

function dur(msv) {
  if (msv == null) return "";
  const s = Math.floor(msv / 1000);
  return s < 60
    ? `${s}s`
    : s < 3600
      ? `${Math.floor(s / 60)}m ${s % 60}s`
      : `${(s / 3600).toFixed(1)}h`;
}

const hms = (s) => (s ? String(s).slice(11, 19) : "");
const oneLine = (s, n = 100) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

function shortModel(m) {
  if (!m) return "?";
  const parts = m
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .split("-");
  return parts[0] + (parts.length > 1 ? " " + parts.slice(1).join(".") : "");
}

const money = (n) => `$${(n || 0).toFixed(2)}`;

// `crew:coder@e1968 (sonnet 5, ctx 81%)`; with `$` when asked (wip).
function agentTag(a, { cost = false } = {}) {
  const id =
    a.type === "main" ? `main@${a.session}` : `${a.type}@${(a.claudeId || a.id).slice(-5)}`;
  if (!a.model) return id;
  return `${id} (${shortModel(a.model)}, ctx ${a.ctxPct}%${cost ? `, ${money(a.cost)}` : ""})`;
}

function findLane(m, letter) {
  for (const s of m.stories) for (const l of s.lanes) if (l.letter === letter) return [s, l];
  return [null, null];
}

function findTask(m, key) {
  for (const s of m.stories)
    for (const l of s.lanes) for (const t of walk(l.tasks)) if (t.key === key) return [s, l, t];
  return [null, null, null];
}

function findAgent(m, ident) {
  return Object.values(m.agents).find(
    (a) => a.id === ident || a.id.endsWith(ident) || (a.claudeId && a.claudeId.endsWith(ident))
  );
}

const storyHead = (s) => (s.kind === "step" ? `step ${s.num}` : `sandbox '${s.title}'`);
const leaves = (l) => [...walk(l.tasks)].filter((t) => t.status === "todo" && !t.children.length);

function summary(m) {
  const now = ms(m.now);
  const out = [`${m.status.text} (as of ${m.status.date})`];
  const blocked = [];
  const reported = [];
  const next = [];
  for (const s of m.stories) {
    const c = s.counts;
    out.push(
      `${storyHead(s)} — ${s.kind === "step" ? s.title : ""} · ${c.done}/${c.total} done, ${c.reported} reported, ${c.doing} doing, ${c.blocked} blocked`
    );
    for (const l of s.lanes) {
      const lc = l.counts;
      let line = `  lane ${l.letter} ${l.name} · ${l.mode || "-"} · ${lc.done}/${lc.total}`;
      if (l.live) {
        const a = m.agents[l.live];
        line += ` · live ${agentTag(a)}${a.box ? ` on ${a.box}` : ""}`;
        if (a.waiting)
          line += ` · WAITING ${a.waiting.kind}${a.waiting.tool ? ` ${a.waiting.tool}` : ""}`;
        line += ` · last: ${oneLine(a.last, 80)} (${ago(a.lastTs, now)})`;
      }
      out.push(line);
      for (const t of walk(l.tasks)) {
        if (t.status === "blocked") blocked.push(`${t.key} (${t.note || "no reason logged"})`);
        else if (t.status === "reported") reported.push(t.key);
      }
      const todo = leaves(l);
      if (todo.length) next.push(todo[0].key);
    }
  }
  out.push(`blocked: ${blocked.join(", ") || "—"}`);
  out.push(`reported (awaiting tick): ${reported.join(", ") || "—"}`);
  out.push(`next: ${next.join(", ") || "—"}`);
  out.push(
    `agents live: ${m.totals.live} · tool calls: ${m.totals.tools} · errors: ${m.totals.errors} · tokens out: ${m.totals.out}`
  );
  return out.slice(0, 60).join("\n");
}

function next(m, n = 3) {
  const out = [];
  for (const s of m.stories) {
    out.push(`${s.kind === "step" ? `step ${s.num}` : "sandbox"} — done when: ${s.doneWhen}`);
    for (const l of s.lanes) {
      const todo = leaves(l).slice(0, n);
      if (!todo.length) continue;
      out.push(`lane ${l.letter} ${l.name} (${l.mode || "-"}) touches ${l.touches}`);
      for (const t of todo) out.push(`  ${t.key} ${t.text}`);
    }
  }
  return out.join("\n") || "nothing to do";
}

// `14:08:42 Edit 0s scripts/scenario-fraud-flagged.sh` — a tool.pre line with
// its post's duration and ERR flag.
function toolLine(e, posts) {
  const p = posts[e.id] || {};
  const err = p.err || p.interrupted ? " ERR" : "";
  return `${hms(e.ts)} ${e.tool} ${dur(p.ms)}${err} ${oneLine(e.cmd || e.file || e.pattern || "")}`;
}

const postsOf = (events) =>
  Object.fromEntries(events.filter((e) => e.ev === "tool.post").map((e) => [e.id, e]));
const mine = (events, a) => events.filter((e) => e.agentId === a.id);

function wip(m, events) {
  const now = ms(m.now);
  const out = [];
  const posts = postsOf(events);
  const live = Object.values(m.agents)
    .filter((a) => a.live)
    .sort((a, b) => ms(a.start) - ms(b.start));
  for (const a of live) {
    let line = `${agentTag(a, { cost: true })} · lane ${a.lane || "?"} ${a.title} · box ${a.box || "-"} · up ${ago(a.start, now).replace(" ago", "")} · ${a.tools} tools, ${a.errors} errors, ${a.out} tokens out · last event ${ago(a.lastTs, now)}`;
    if (a.waiting)
      line += ` · WAITING ${a.waiting.kind}${a.waiting.tool ? ` ${a.waiting.tool}` : ""} (${ago(a.waiting.since, now)})`;
    out.push(line);
    if (a.say) out.push(`    say: ${a.say}`);
    for (const e of mine(events, a)
      .filter((e) => e.ev === "tool.pre")
      .slice(-3))
      out.push(`    ${toolLine(e, posts)}`);
  }
  return out.join("\n") || "no agent is live";
}

function taskLine(t, m) {
  const a = t.agentId ? m.agents[t.agentId] : null;
  const bits = [
    `${"  ".repeat(t.depth)}[${t.status === "done" ? "x" : t.status[0]}] ${t.key} ${t.text}`,
  ];
  if (t.agent) bits.push(t.agent + (a && a.model ? ` (${shortModel(a.model)})` : ""));
  if (t.started) bits.push(hms(t.started));
  if (t.ms != null) bits.push(dur(t.ms));
  if (t.tools) bits.push(`${t.tools} tools` + (t.errors ? `, ${t.errors} errors` : ""));
  return bits.join(" · ");
}

function lane(m, letter) {
  const [, l] = findLane(m, letter);
  if (!l) return null;
  const out = [
    `lane ${l.letter} ${l.name} · ${l.tags.join(" · ")}`,
    `touches: ${l.touches}`,
    `${l.counts.done}/${l.counts.total} done · live: ${l.live ? agentTag(m.agents[l.live]) : "-"}`,
  ];
  for (const t of walk(l.tasks)) out.push(taskLine(t, m));
  return out.join("\n");
}

function task(m, key, events) {
  const [s, l, t] = findTask(m, key);
  if (!t) return null;
  const crumbs = [s.kind === "step" ? `step ${s.num}` : `sandbox ${s.title}`, `lane ${l.letter}`];
  const parts = key.split(".");
  for (let i = 1; i < parts.length; i++) crumbs.push(parts.slice(0, i).join("."));
  const a = t.agentId ? m.agents[t.agentId] : null;
  const out = [
    [...crumbs, key].join(" › "),
    `status: ${t.status}`,
    t.text,
    `agent: ${t.agent || "-"}` + (a ? ` · ${agentTag(a)}` : ""),
    `started: ${hms(t.started)} · finished: ${hms(t.finished)} · ${dur(t.ms)} · ${t.tools} tools, ${t.errors} errors`,
  ];
  for (const ln of t.log) out.push(`  ${hms(ln.ts)} ${ln.agent} ${ln.status} ${ln.note}`);
  if (t.children.length) {
    out.push("children:");
    for (const c of walk(t.children)) out.push("  " + taskLine(c, m));
  }
  if (a) {
    const starts = t.log.filter((x) => x.status === "start");
    if (starts.length) {
      const t0 = ms(starts[0].ts);
      const end = t.log.find(
        (x) => ms(x.ts) > t0 && (x.status === "done" || x.status === "blocked")
      );
      const t1 = end ? ms(end.ts) : null;
      const posts = postsOf(events);
      const rows = mine(events, a)
        .filter((e) => e.ev === "tool.pre" && ms(e.ts) >= t0 && (!t1 || ms(e.ts) < t1))
        .slice(-20);
      if (rows.length) out.push("tool events:");
      for (const e of rows) out.push(`  ${toolLine(e, posts)}`);
    }
  }
  return out.join("\n");
}

function agent(m, ident, events) {
  const a = findAgent(m, ident);
  if (!a) return null;
  const now = ms(m.now);
  const out = [
    `${agentTag(a, { cost: true })} · session ${a.session} · ${a.live ? "live" : `stopped ${hms(a.stop || "")}`}`,
    `lane ${a.lane || "?"} ${a.title} · box ${a.box || "-"} · started ${hms(a.start)} (${ago(a.start, now)})`,
    `model ${a.model || "?"} · ${a.calls} calls · ${a.out} tokens out · ctx ${a.ctx} (${a.ctxPct}%) · ${money(a.cost)}`,
    `${a.tools} tools · ${a.errors} errors · last: ${oneLine(a.last, 120)}`,
  ];
  if (a.waiting)
    out.push(
      `WAITING ${a.waiting.kind}${a.waiting.tool ? ` ${a.waiting.tool}` : ""} since ${hms(a.waiting.since)}`
    );
  if (a.say) out.push(`say: ${a.say}`);
  const posts = postsOf(events);
  for (const e of mine(events, a)
    .filter((e) => e.ev === "tool.pre")
    .slice(-30))
    out.push(`  ${toolLine(e, posts)}`);
  return out.join("\n");
}

module.exports = {
  summary,
  next,
  wip,
  lane,
  task,
  agent,
  findLane,
  findTask,
  findAgent,
  agentTag,
  ago,
  dur,
  hms,
  shortModel,
};
