#!/usr/bin/env node

/**
 * Seeds CCAM's `sessions` / `agents` / `events` tables from a v2 ledgerflow
 * board (`board.py`/ADR 0001) `events.jsonl` — either the ledgerflow plan
 * fixture (test/fixtures/plan/ledgerflow/) for tests, or the real
 * `<project>/.local/events.jsonl` at cutover (docs/plan-layer.md §8 step 2).
 * Idempotent: existing sessions/agents are left untouched; existing tool
 * events are skipped by tool_use_id.
 *
 * Mapping (v2 events.jsonl line -> CCAM rows) — see docs/plan-layer.md §4.2/§4.4:
 *
 *   session: "selftest"        -> the whole line is skipped
 *   session (8-char prefix)    -> sessions.id (used verbatim); sessions.cwd
 *                                 = --cwd; sessions.status = 'completed'
 *                                 unless the session's last event is within
 *                                 30 min of `now`, else 'active';
 *                                 sessions.transcript_path = the main's first
 *                                 line carrying `transcript`, resolved
 *                                 against fixtureDir
 *   agent === "main"           -> one agents row, id `main@<session>`,
 *                                 type='main', name='main'
 *   agent !== "main" (each     -> one agents row, id = the v2 agent id,
 *     distinct id)                type='subagent', parent_agent_id = the
 *                                 session's main row,
 *                                 subagent_type = v2 `type` off this
 *                                   agent's first line (any kind — covers
 *                                   agents whose only line is agent.stop),
 *                                 task = "Lane <lane> — <title>": at each
 *                                   agent.start take the line's own
 *                                   `lane`/`title`; while the agent has no
 *                                   lane, claim the earliest unclaimed
 *                                   dispatching tool.pre (agent: "main",
 *                                   tool: "Agent", carrying `lane`) at or
 *                                   before that start (v2's rule; titles only
 *                                   from `title` fields, never `desc`);
 *                                   stop-only rows never claim; else null,
 *                                 started_at = first agent.start ts, else
 *                                   this agent's first event ts,
 *                                 ended_at/status = last agent.stop ts /
 *                                   'completed', else null / 'working',
 *                                 metadata = JSON {transcript_path} — the
 *                                   first agent.start line carrying
 *                                   `transcript`, resolved against
 *                                   fixtureDir with forward slashes
 *   ev: "tool.pre"              -> events row, event_type='PreToolUse',
 *                                 tool_name = v2 `tool`, summary = v2 `desc`
 *                                 else `cmd`'s first 80 chars, data = {
 *                                   tool_use_id: id, tool_input: {
 *                                   command|file_path|pattern|description,
 *                                   subagent_type, prompt: "Lane X — title"
 *                                   when the line carries lane } }
 *   ev: "tool.post"             -> events row, event_type='PostToolUse',
 *                                 data = { tool_use_id, tool_name, ms,
 *                                   tool_response: {stdout, stderr,
 *                                   interrupted}, is_error }.
 *                                 Deviation from the original spec for this
 *                                 line: there is no "PostToolUseFailure"
 *                                 event_type anywhere in CCAM (checked
 *                                 server/routes/hooks.js and
 *                                 scripts/import-history.js:1037-1118) — the
 *                                 real ingest path always writes
 *                                 PostToolUse and flags failure with
 *                                 `data.is_error`, so that's what this
 *                                 mirrors instead of inventing an event type.
 *   ev: "agent.start"/"agent.stop" -> folded into the agent row above, no
 *                                 events row of their own
 *
 * Usage:
 *   node test/fixtures/plan/seed.js --from <events.jsonl> --cwd <project cwd> [--fixture-dir <dir>]
 *
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const fs = require("fs");
const path = require("path");

const THIRTY_MIN_MS = 30 * 60 * 1000;

function readLines(eventsPath) {
  return fs
    .readFileSync(eventsPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.session !== "selftest");
}

function resolveTranscript(fixtureDir, rel) {
  if (!rel) return null;
  return path.resolve(fixtureDir, rel).split(path.sep).join("/");
}

function laneTask(lane, title) {
  if (!lane) return null;
  return title ? `Lane ${lane} — ${title}` : `Lane ${lane}`;
}

function toolInput(line) {
  const input = {};
  if (line.cmd != null) input.command = line.cmd;
  if (line.file != null) input.file_path = line.file;
  if (line.pattern != null) input.pattern = line.pattern;
  if (line.desc != null) input.description = line.desc;
  if (line.subagent != null) input.subagent_type = line.subagent;
  if (line.lane != null) input.prompt = `Lane ${line.lane}${line.title ? ` — ${line.title}` : ""}`;
  return input;
}

function preSummary(line) {
  if (line.desc) return line.desc;
  if (line.cmd) return line.cmd.slice(0, 80);
  return null;
}

/**
 * Seed from an explicit events.jsonl path. `fixtureDir` is only used to
 * resolve `transcript` fields (relative or absolute — path.resolve handles
 * both). Returns { sessions, agents, events } counts of rows actually
 * inserted (idempotent reruns report 0 for anything already present).
 */
function seedFromFile(dbModule, eventsPath, { fixtureDir, cwd, now }) {
  const { db, stmts } = dbModule;
  const nowMs = new Date(now || Date.now()).getTime();
  const lines = readLines(eventsPath);

  const bySession = new Map();
  for (const l of lines) {
    if (!bySession.has(l.session)) bySession.set(l.session, []);
    bySession.get(l.session).push(l);
  }

  const insertEventStmt = db.prepare(
    "INSERT INTO events (session_id, agent_id, event_type, tool_name, summary, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  // No unique constraint on events, so idempotency is a manual existence
  // check keyed on tool_use_id — same pattern as
  // scripts/import-history.js's importSubagentFromJsonl.
  const eventExistsStmt = db.prepare(
    "SELECT 1 FROM events WHERE session_id = ? AND event_type = ? AND data LIKE ? LIMIT 1"
  );
  const setSessionTimes = db.prepare(
    "UPDATE sessions SET started_at = ?, ended_at = ? WHERE id = ?"
  );
  const setAgentTimes = db.prepare("UPDATE agents SET started_at = ?, ended_at = ? WHERE id = ?");
  const setSessionTranscript = db.prepare("UPDATE sessions SET transcript_path = ? WHERE id = ?");

  const counts = { sessions: 0, agents: 0, events: 0 };

  function insertToolEvent(sessionId, agentId, line) {
    const marker = `%"tool_use_id":${JSON.stringify(line.id)}%`;
    if (line.ev === "tool.pre") {
      if (eventExistsStmt.get(sessionId, "PreToolUse", marker)) return;
      const data = { tool_use_id: line.id, tool_input: toolInput(line) };
      insertEventStmt.run(
        sessionId,
        agentId,
        "PreToolUse",
        line.tool || null,
        preSummary(line),
        JSON.stringify(data),
        line.ts
      );
      counts.events++;
    } else {
      if (eventExistsStmt.get(sessionId, "PostToolUse", marker)) return;
      const data = {
        tool_use_id: line.id,
        tool_name: line.tool || null,
        ms: line.ms,
        tool_response: { stdout: line.out, stderr: line.err, interrupted: line.interrupted },
        is_error: !!(line.err || line.interrupted),
      };
      insertEventStmt.run(
        sessionId,
        agentId,
        "PostToolUse",
        line.tool || null,
        `Tool completed: ${line.tool || ""}`,
        JSON.stringify(data),
        line.ts
      );
      counts.events++;
    }
  }

  const tx = db.transaction(() => {
    for (const [sessionId, rawLines] of bySession) {
      const sessionLines = [...rawLines].sort((a, b) => new Date(a.ts) - new Date(b.ts));
      const tss = sessionLines.map((l) => new Date(l.ts).getTime());
      const minTs = Math.min(...tss);
      const maxTs = Math.max(...tss);
      const status = nowMs - maxTs <= THIRTY_MIN_MS ? "active" : "completed";

      if (!stmts.getSession.get(sessionId)) {
        stmts.insertSession.run(sessionId, null, status, cwd, null, null);
        setSessionTimes.run(
          new Date(minTs).toISOString(),
          status === "completed" ? new Date(maxTs).toISOString() : null,
          sessionId
        );
        counts.sessions++;
      }
      // Main transcripts feed the main agent's model/ctx/tokens (v2 registers
      // them the same way); the join reads sessions.transcript_path.
      const mainTranscript = sessionLines.find((l) => l.agent === "main" && l.transcript);
      if (mainTranscript) {
        setSessionTranscript.run(
          resolveTranscript(fixtureDir, mainTranscript.transcript),
          sessionId
        );
      }

      const mainId = `main@${sessionId}`;
      if (!stmts.getAgent.get(mainId)) {
        stmts.insertAgent.run(
          mainId,
          sessionId,
          "main",
          "main",
          null,
          status === "completed" ? "completed" : "working",
          null,
          null,
          null
        );
        setAgentTimes.run(
          new Date(minTs).toISOString(),
          status === "completed" ? new Date(maxTs).toISOString() : null,
          mainId
        );
        counts.agents++;
      }

      // Group this session's lines by non-main agent id, preserving the
      // chronological order sessionLines was just sorted into.
      const perAgent = new Map();
      for (const l of sessionLines) {
        if (l.agent === "main") continue;
        if (!perAgent.has(l.agent)) perAgent.set(l.agent, []);
        perAgent.get(l.agent).push(l);
      }

      // Dispatching Agent tool.pre lines, for the lane-fallback match below.
      const dispatches = sessionLines
        .filter((l) => l.agent === "main" && l.ev === "tool.pre" && l.tool === "Agent" && l.lane)
        .map((l) => ({
          ts: new Date(l.ts).getTime(),
          lane: l.lane,
          title: l.title,
          claimed: false,
        }));

      // Process agents in ascending first-event order so "first unclaimed,
      // by time" dispatch matching is deterministic — and so a rerun that
      // finds some agents already inserted still claims dispatches in the
      // same order a from-scratch run would (lane/task is computed for
      // every agent below, insertion is what's actually skipped).
      const agentIds = [...perAgent.keys()].sort(
        (a, b) => new Date(perAgent.get(a)[0].ts) - new Date(perAgent.get(b)[0].ts)
      );

      for (const agentId of agentIds) {
        const evs = perAgent.get(agentId);
        const starts = evs.filter((l) => l.ev === "agent.start");
        const stops = evs.filter((l) => l.ev === "agent.stop");

        // v2 rule (board.py Board._build): at each agent.start, take the line's
        // own lane/title; while the agent still has no lane, claim the earliest
        // unclaimed dispatch at or before that start. Stop-only rows never claim.
        let lane = null;
        let title = null;
        for (const st of starts) {
          lane = st.lane || lane;
          title = st.title || title;
          if (!lane) {
            const stTs = new Date(st.ts).getTime();
            const candidate = dispatches.find((d) => !d.claimed && d.ts <= stTs);
            if (candidate) {
              candidate.claimed = true;
              lane = candidate.lane;
              title = candidate.title || null;
            }
          }
        }

        if (!stmts.getAgent.get(agentId)) {
          const startedAt = starts.length > 0 ? starts[0].ts : evs[0].ts;
          const endedAt = stops.length > 0 ? stops[stops.length - 1].ts : null;
          const subagentType = evs[0].type || null;
          const transcriptLine = starts.find((l) => l.transcript);
          const metadata = transcriptLine
            ? JSON.stringify({
                transcript_path: resolveTranscript(fixtureDir, transcriptLine.transcript),
              })
            : null;

          stmts.insertAgent.run(
            agentId,
            sessionId,
            subagentType || `Subagent ${agentId.slice(0, 8)}`,
            "subagent",
            subagentType,
            endedAt ? "completed" : "working",
            laneTask(lane, title),
            mainId,
            metadata
          );
          setAgentTimes.run(startedAt, endedAt, agentId);
          counts.agents++;
        }

        for (const l of evs) {
          if (l.ev === "tool.pre" || l.ev === "tool.post") insertToolEvent(sessionId, agentId, l);
        }
      }

      // main's own tool calls, including the dispatching "Agent" tool.pre
      // lines themselves (matches CCAM's real PreToolUse-spawns-a-row shape).
      for (const l of sessionLines) {
        if (l.agent === "main" && (l.ev === "tool.pre" || l.ev === "tool.post")) {
          insertToolEvent(sessionId, mainId, l);
        }
      }
    }
  });
  tx();

  return counts;
}

/** Fixture-dir convention: reads `<fixtureDir>/events.jsonl`. */
function seed(dbModule, { fixtureDir, cwd, now }) {
  return seedFromFile(dbModule, path.join(fixtureDir, "events.jsonl"), { fixtureDir, cwd, now });
}

module.exports = { seed, seedFromFile };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.from || !args.cwd) {
    console.error(
      "Usage: node test/fixtures/plan/seed.js --from <events.jsonl> --cwd <project cwd> [--fixture-dir <dir>]"
    );
    process.exit(1);
  }
  const fromPath = path.resolve(args.from);
  const fixtureDir = args["fixture-dir"]
    ? path.resolve(args["fixture-dir"])
    : path.dirname(fromPath);
  const dbModule = require("../../../server/db");
  const counts = seedFromFile(dbModule, fromPath, {
    fixtureDir,
    cwd: args.cwd,
    now: new Date().toISOString(),
  });
  console.log(
    `Seeded ${counts.sessions} sessions, ${counts.agents} agents, ${counts.events} events.`
  );
}
