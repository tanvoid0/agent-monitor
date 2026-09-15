/**
 * @file The plan join (docs/plan-layer.md §4.4): plans.parsed + plan_log for
 * the current step + CCAM's sessions / agents / events for that cwd + the
 * per-agent transcript figures → the v2 model shape. A port of the v2 board's
 * `_build`, reading CCAM rows instead of events.jsonl. `now` is a parameter
 * (default wall clock) because every relative figure is against it.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const path = require("path");
const { db, stmts } = require("../db");
const { walk } = require("./parser");
const { figures } = require("./tail");

const LIVE_AGENT_MS = 30 * 60 * 1000;
const LIVE_MAIN_MS = 10 * 60 * 1000;
const CACHE_MS = 5000;

const q = {
  cwds: db.prepare(
    "SELECT id, cwd, transcript_path FROM sessions WHERE cwd IS NOT NULL AND cwd != ''"
  ),
  logSince: db.prepare("SELECT MIN(created_at) AS t FROM plan_log WHERE cwd = ? AND step = ?"),
  log: db.prepare(
    "SELECT id, key, agent, status, note, created_at AS ts FROM plan_log WHERE cwd = ? AND step = ? ORDER BY created_at, id"
  ),
  // New rows and late transcript_path stamps are the only sessions changes
  // the join cares about. Ceiling: a session deleted and another inserted in
  // the same rowid with an older started_at would not be noticed.
  sessionsKey: db.prepare(
    "SELECT COUNT(*) AS n, MAX(rowid) AS r, MAX(started_at) AS s, SUM(transcript_path IS NOT NULL) AS t FROM sessions"
  ),
  version: db.prepare(
    `SELECT (SELECT MAX(id) FROM events WHERE session_id IN (SELECT id FROM sessions WHERE cwd IN (SELECT value FROM json_each(?)))) AS e,
            (SELECT MAX(updated_at) FROM agents WHERE session_id IN (SELECT id FROM sessions WHERE cwd IN (SELECT value FROM json_each(?)))) AS a,
            (SELECT MAX(id) FROM plan_log WHERE cwd = ?) AS l`
  ),
};

const ms = (s) => (s ? Date.parse(s) : NaN);
const laneOf = (text) => {
  const m = /^\s*Lane ([A-Z])\b(?:\s*[—–-]\s*([^\n.]{0,60}))?/.exec(text || "");
  return m ? { lane: m[1], title: (m[2] || "").trim() } : null;
};
const oneLine = (s, n = 100) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const parseJson = (s) => {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

// Log lines are self-labelled: 'A' (the lane), 'crew:coder' (the type), a
// 5-char id suffix, the id itself, or 'main'.
function labelMatches(label, a) {
  const cid = a.claudeId || a.id;
  return (
    label === a.type ||
    label === a.lane ||
    label === a.id ||
    label === cid ||
    label === cid.slice(-5) ||
    (label === "main" && a.type === "main")
  );
}

function counts(tasks) {
  const c = { done: 0, reported: 0, doing: 0, blocked: 0, todo: 0, total: 0 };
  for (const t of tasks) {
    c[t.status] += 1;
    c.total += 1;
  }
  return c;
}

// v2's tool_fields: what a tool call was "about", from CCAM's tool_input.
function toolFields(tool, input, cwd) {
  const rel = (p) => {
    if (!p) return "";
    const s = String(p);
    return (path.isAbsolute(s) ? path.relative(cwd, s) : s).split(path.sep).join("/");
  };
  const f = {};
  if (tool === "Bash") {
    f.cmd = (input.command || "").slice(0, 400);
    if (input.description) f.desc = input.description.slice(0, 120);
  } else if (["Edit", "Write", "Read", "NotebookEdit", "MultiEdit"].includes(tool)) {
    f.file = rel(input.file_path || input.notebook_path);
  } else if (tool === "Grep" || tool === "Glob") {
    f.pattern = (input.pattern || "").slice(0, 120);
    if (input.path) f.file = rel(input.path);
  } else if (tool === "Agent") {
    f.desc = (input.description || "").slice(0, 120);
  }
  return f;
}

const isErrorPost = (d) =>
  !!(d.is_error || d.tool_response?.interrupted || d.tool_response?.stderr || d.failed);

// Notification payloads: "Claude needs your permission to use Bash" /
// "Claude is waiting for your input".
function waitingOf(message) {
  const m = String(message || "");
  const tool = /to (?:use|run) (\w+)/i.exec(m);
  return { kind: /permission/i.test(m) ? "permission" : "input", tool: tool ? tool[1] : null };
}

// The raw sessions.cwd spellings that resolve to this plan's cwd. Memoised
// per cwd: the pusher asks every 250 ms and the table only matters to the join
// when a session is added or gets its transcript path.
const sessionsCache = new Map(); // cwd -> { key, value }
function sessionsOf(plan) {
  const k = q.sessionsKey.get();
  const key = `${k.n}|${k.r}|${k.s}|${k.t}`;
  const hit = sessionsCache.get(plan.cwd);
  if (hit && hit.key === key) return hit.value;
  const rows = q.cwds.all().filter((s) => path.resolve(s.cwd) === plan.cwd);
  const value = {
    ids: rows.map((s) => s.id),
    cwds: [...new Set(rows.map((s) => s.cwd))],
    transcript: Object.fromEntries(rows.map((s) => [s.id, s.transcript_path])),
  };
  sessionsCache.set(plan.cwd, { key, value });
  return value;
}

function version(plan, sessions = sessionsOf(plan)) {
  const cwds = JSON.stringify(sessions.cwds);
  const v = q.version.get(cwds, cwds, plan.cwd);
  return `${plan.updated_at}|${v.e}|${v.a}|${v.l}`;
}

function inList(n) {
  return n ? `(${Array(n).fill("?").join(",")})` : "(NULL)";
}

function build(plan, now, sessions, transcriptCache) {
  const nowMs = now.getTime();
  const parsed = JSON.parse(plan.parsed);
  const stories = JSON.parse(JSON.stringify(parsed.stories));
  const cur = parsed.steps.current;
  const pricing = stmts.listPricing.all();

  // The step's window opens at the earlier of: the step number first seen by
  // the watcher, and the step's first log line.
  const logSince = ms(cur != null ? q.logSince.get(plan.cwd, cur).t : null);
  const sinceMs = Math.min(ms(plan.step_since) || nowMs, logSince || Infinity);
  const since = new Date(sinceMs).toISOString();

  const laneStory = {};
  for (const s of stories)
    for (const l of s.lanes) if (!laneStory[l.letter]) laneStory[l.letter] = [s, l];

  const events = sessions.ids.length
    ? db
        .prepare(
          `SELECT id, session_id, agent_id, event_type, tool_name, summary, data, created_at
           FROM events WHERE session_id IN ${inList(sessions.ids.length)} AND created_at >= ?
           ORDER BY created_at, id`
        )
        .all(...sessions.ids, since)
    : [];
  const rows = sessions.ids.length
    ? db
        .prepare(
          `SELECT * FROM agents WHERE session_id IN ${inList(sessions.ids.length)}
           AND COALESCE(subagent_type, '') != 'compaction' ORDER BY started_at, id`
        )
        .all(...sessions.ids)
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const e of events) {
    e.tsMs = ms(e.created_at);
    e.isTool = e.event_type === "PreToolUse" || e.event_type === "PostToolUse";
  }
  // Agent dispatches, for agent → lane — the PreToolUse, or the PostToolUse
  // when the Pre was dropped (same tool_input; deduplicated by tool_use_id). A
  // live-hook spawn event is attributed to the spawned row (remembered in
  // `spawnOf`) and then, for the plan, moved to the dispatcher — its tool
  // call, as in the JSONL import and v2.
  const dispatches = {}; // session -> [{ts, lane, title, claimed}]
  const spawnOf = {}; // spawned row id -> its dispatch
  const dispatchByUse = new Map(); // tool_use_id -> dispatch
  for (const e of events) {
    if (!e.isTool || e.tool_name !== "Agent") continue;
    const data = parseJson(e.data);
    if (data.tool_use_id && dispatchByUse.has(data.tool_use_id)) continue;
    const lo = laneOf(data.tool_input?.prompt);
    const d = {
      ts: e.tsMs,
      lane: lo ? lo.lane : null,
      title: lo ? lo.title : "",
      claimed: false,
    };
    (dispatches[e.session_id] ||= []).push(d);
    if (data.tool_use_id) dispatchByUse.set(data.tool_use_id, d);
    if (e.event_type === "PreToolUse" && /^Subagent spawned:/.test(e.summary || "")) {
      const row = byId.get(e.agent_id);
      if (row && row.parent_agent_id) {
        spawnOf[row.id] = d;
        e.agent_id = row.parent_agent_id;
      }
    }
  }
  const eventsByAgent = new Map();
  for (const e of events) {
    if (!eventsByAgent.has(e.agent_id)) eventsByAgent.set(e.agent_id, []);
    eventsByAgent.get(e.agent_id).push(e);
  }
  // First unclaimed dispatch in the session at or before `ts`, on `lane` when
  // given (a row whose task names its lane still consumes the dispatch that
  // spawned it, so a later row cannot re-claim it).
  const claim = (session, ts, lane) => {
    const d = (dispatches[session] || []).find(
      (x) => !x.claimed && x.ts <= ts && (lane ? x.lane === lane : x.lane)
    );
    if (d) d.claimed = true;
    return d;
  };

  // Agents on this step: a tool call inside the window, or a subagent that
  // started or stopped inside it. A main whose only event is a reaper Stop is
  // not on the step.
  const agents = {};
  for (const r of rows) {
    const mine = eventsByAgent.get(r.id) || [];
    const isMain = r.type === "main";
    const inWindow =
      mine.some((e) => e.isTool) ||
      (!isMain && (ms(r.started_at) >= sinceMs || ms(r.ended_at) >= sinceMs));
    if (!inWindow) continue;
    const meta = parseJson(r.metadata);
    const a = {
      id: r.id,
      claudeId: r.claude_agent_id || null,
      type: isMain ? "main" : r.subagent_type || "agent",
      session: r.session_id.slice(0, 8),
      lane: null,
      story: null,
      title: "",
      start: r.started_at,
      stop: r.ended_at,
      live: false,
      waiting: null,
      say: null,
      lastTs: r.ended_at || r.started_at,
      lastTool: null,
      last: "",
      tools: 0,
      errors: 0,
      box: null,
      model: null,
      calls: 0,
      out: 0,
      ctx: 0,
      ctxPct: 0,
      cost: 0,
      status: r.status,
    };
    if (isMain) {
      if (laneStory.C) a.lane = "C";
    } else {
      const lo = laneOf(r.task);
      if (spawnOf[r.id]) spawnOf[r.id].claimed = true;
      if (lo) {
        a.lane = lo.lane;
        a.title = lo.title;
        if (!spawnOf[r.id]) claim(r.session_id, ms(r.started_at), lo.lane);
      } else {
        const d = spawnOf[r.id] || claim(r.session_id, ms(r.started_at));
        if (d && d.lane) {
          a.lane = d.lane;
          a.title = d.title;
        }
      }
    }
    let lastNotification = null;
    for (const e of mine) {
      if (e.tsMs > ms(a.lastTs)) a.lastTs = e.created_at;
      if (e.event_type === "PreToolUse") {
        const f = toolFields(e.tool_name, parseJson(e.data).tool_input || {}, plan.cwd);
        a.tools += 1;
        a.lastTool = e.tool_name;
        a.last = oneLine(f.cmd || f.file || f.pattern || f.desc || "", 400);
      } else if (e.event_type === "PostToolUse") {
        if (isErrorPost(parseJson(e.data))) a.errors += 1;
      } else if (e.event_type === "Notification") {
        lastNotification = e;
      }
    }
    // v2's rule: not finished, and active within 30 min (subagent) / 10 min
    // (main). A main waiting on its subagents is live.
    const age = nowMs - ms(a.lastTs);
    a.live =
      r.status !== "completed" &&
      r.status !== "error" &&
      age < (isMain ? LIVE_MAIN_MS : LIVE_AGENT_MS);
    const blocked = r.status === "waiting" && r.awaiting_reason === "notification";
    if (blocked && r.awaiting_input_since) {
      a.waiting = {
        ...waitingOf(lastNotification ? parseJson(lastNotification.data).message : ""),
        since: r.awaiting_input_since,
      };
    }
    const transcript = isMain ? sessions.transcript[r.session_id] : meta.transcript_path;
    if (transcript) {
      const fig = figures(path.resolve(plan.cwd, transcript), {
        transcriptCache,
        pricing,
        asOf: r.started_at ? r.started_at.slice(0, 10) : undefined,
      });
      if (fig) Object.assign(a, fig);
    }
    if (a.lane && laneStory[a.lane]) a.story = laneStory[a.lane][0].id;
    agents[r.id] = a;
  }
  const agentList = Object.values(agents);

  // Tasks: one pool of log lines for the current step.
  const pool = cur != null ? q.log.all(plan.cwd, cur) : [];
  for (const s of stories) {
    const keys = new Set();
    for (const l of s.lanes) {
      keys.add(l.letter);
      for (const t of walk(l.tasks)) keys.add(t.key);
    }
    const lines = pool.filter((ln) => keys.has(ln.key));
    const byKey = {};
    for (const ln of lines) (byKey[ln.key] ||= []).push(ln);
    // windows per label: a start line → until the label's next later line
    // that is another key's start or this key's done/blocked (several starts
    // in one second keep overlapping windows rather than empty ones)
    const windows = [];
    const perLabel = {};
    for (const ln of lines) {
      if (ln.status !== "note") (perLabel[ln.agent] ||= []).push(ln);
    }
    for (const [label, lns] of Object.entries(perLabel)) {
      lns.forEach((ln, i) => {
        if (ln.status !== "start") return;
        const t1 = lns
          .slice(i + 1)
          .find(
            (x) =>
              ms(x.ts) > ms(ln.ts) &&
              ((x.key !== ln.key && x.status === "start") || x.key === ln.key)
          );
        windows.push({ label, key: ln.key, t0: ms(ln.ts), t1: t1 ? ms(t1.ts) : null });
      });
    }
    for (const l of s.lanes) {
      const laneAgents = agentList.filter((a) => a.lane === l.letter);
      l.agents = laneAgents.map((a) => a.id);
      const live = laneAgents.filter((a) => a.live);
      l.live = live.length ? live[live.length - 1].id : null;
      for (const t of walk(l.tasks)) {
        const tl = (byKey[t.key] || []).map((ln) => ({
          ts: ln.ts,
          agent: ln.agent,
          status: ln.status,
          note: ln.note || "",
        }));
        t.log = tl;
        const last = tl.length ? tl[tl.length - 1] : null;
        t.note = last && last.note ? last.note : null;
        const own = t.ticked
          ? "done"
          : !last
            ? "todo"
            : last.status === "done"
              ? "reported"
              : last.status === "blocked"
                ? "blocked"
                : "doing";
        t.status = own;
        const starts = tl.filter((x) => x.status === "start");
        const dones = tl.filter((x) => x.status === "done");
        const label = (starts[0] || dones[0] || { agent: null }).agent;
        t.agent = label;
        const cands = label ? laneAgents.filter((a) => labelMatches(label, a)) : [];
        t.agentId = cands.length ? cands[cands.length - 1].id : null;
        t.started = starts.length
          ? starts[0].ts
          : (l.live && own === "doing" && agents[l.live].start) || null;
        t.finished = dones.length ? dones[dones.length - 1].ts : null;
        const t0 = ms(t.started);
        const t1 = ms(t.finished);
        t.ms = t0 && t1 ? t1 - t0 : t0 && own === "doing" ? nowMs - t0 : null;
        let tools = 0;
        let errors = 0;
        for (const w of windows) {
          if (w.key !== t.key) continue;
          for (const ag of laneAgents) {
            if (!labelMatches(w.label, ag)) continue;
            for (const e of eventsByAgent.get(ag.id) || []) {
              if (!e.isTool || e.tsMs < w.t0 || (w.t1 && e.tsMs >= w.t1)) continue;
              if (e.event_type === "PreToolUse") tools += 1;
              else if (isErrorPost(parseJson(e.data))) errors += 1;
            }
          }
        }
        t.tools = tools;
        t.errors = errors;
      }
      // roll-up, children first
      const roll = (t) => {
        for (const c of t.children) roll(c);
        if (t.children.length && !t.ticked) {
          const cs = [...walk(t.children)].map((c) => c.status);
          if (cs.includes("blocked")) t.status = "blocked";
          else if (cs.includes("doing") || cs.includes("reported")) t.status = "doing";
        }
      };
      for (const t of l.tasks) roll(t);
      l.counts = counts(walk(l.tasks));
    }
    s.counts = counts(s.lanes.flatMap((l) => [...walk(l.tasks)]));
    // the agent's open box
    for (const w of windows) {
      if (w.t1 !== null) continue;
      for (const a of agentList) if (a.lane === w.key[0] && labelMatches(w.label, a)) a.box = w.key;
    }
  }

  const totals = {
    agents: agentList.length,
    live: agentList.filter((a) => a.live).length,
    waiting: agentList.filter((a) => a.waiting).length,
    tools: agentList.reduce((n, a) => n + a.tools, 0),
    errors: agentList.reduce((n, a) => n + a.errors, 0),
    out: agentList.reduce((n, a) => n + a.out, 0),
    cost: Math.round(agentList.reduce((n, a) => n + a.cost, 0) * 100) / 100,
    sessions: [...new Set(agentList.map((a) => a.session))].sort(),
  };
  return {
    now: now.toISOString(),
    project: { slug: plan.slug, cwd: plan.cwd, step: cur },
    status: parsed.status,
    steps: parsed.steps,
    milestones: parsed.milestones,
    stories,
    agents,
    totals,
  };
}

// Cached per cwd until any input changes (a sessions/agents/events write for
// the cwd, a plan_log insert, a re-parse) — or 5 s, since live agents' ages
// and transcripts move without a row changing.
const cache = new Map(); // cwd -> { version, builtAt, model }

/**
 * The model for a plans row. `now` (Date) defaults to the wall clock; passing
 * one bypasses the cache. `transcriptCache` is the hooks router's instance.
 */
function model(plan, { now, transcriptCache } = {}) {
  const sessions = sessionsOf(plan);
  if (now) return build(plan, now, sessions, transcriptCache);
  const v = version(plan, sessions);
  const hit = cache.get(plan.cwd);
  if (hit && hit.version === v && Date.now() - hit.builtAt < CACHE_MS) return hit.model;
  const m = build(plan, new Date(), sessions, transcriptCache);
  cache.set(plan.cwd, { version: v, builtAt: Date.now(), model: m });
  return m;
}

/** v2 line shape for events.jsonl exports and the text views' tool lists. */
function eventLines(plan, { limit = 5000 } = {}) {
  const sessions = sessionsOf(plan);
  if (!sessions.ids.length) return [];
  const rows = db
    .prepare(
      `SELECT e.session_id, e.agent_id, e.event_type, e.tool_name, e.summary, e.data, e.created_at,
              a.type AS agent_kind, a.subagent_type, a.claude_agent_id
       FROM events e LEFT JOIN agents a ON a.id = e.agent_id
       WHERE e.session_id IN ${inList(sessions.ids.length)}
         AND e.event_type IN ('PreToolUse', 'PostToolUse')
       ORDER BY e.created_at DESC, e.id DESC LIMIT ?`
    )
    .all(...sessions.ids, limit)
    .reverse();
  return rows.map((r) => {
    const d = parseJson(r.data);
    const isMain = r.agent_kind === "main";
    const line = {
      ts: r.created_at,
      session: r.session_id.slice(0, 8),
      // the v2 page keys model.agents by `agent`; CCAM ids for everyone
      agent: r.agent_id,
      agentId: r.agent_id,
      type: isMain ? "main" : r.subagent_type || "agent",
      step: plan.step,
      ev: r.event_type === "PreToolUse" ? "tool.pre" : "tool.post",
      tool: r.tool_name,
      id: d.tool_use_id,
    };
    if (line.ev === "tool.pre")
      Object.assign(line, toolFields(r.tool_name, d.tool_input || {}, plan.cwd));
    else {
      const tr = d.tool_response || {};
      const msv = d.ms ?? d.duration_ms;
      if (msv != null) line.ms = msv;
      if (tr.stdout) line.out = String(tr.stdout).slice(-600);
      if (tr.stderr) line.err = String(tr.stderr).slice(-600);
      if (tr.interrupted) line.interrupted = true;
      if (d.is_error && !line.err) line.err = "failed";
    }
    return line;
  });
}

module.exports = {
  model,
  build,
  version,
  eventLines,
  sessionsOf,
  laneOf,
  labelMatches,
  toolFields,
};
