/**
 * @file Exact subagent attribution through Claude Code's `agent_id`.
 *
 * SubagentStart carries the subagent's own id; every PreToolUse / PostToolUse /
 * Notification / SubagentStop fired inside that subagent carries the same id.
 * Before this, tool events were attributed to the "deepest working subagent"
 * and SubagentStop matched by name/type/prompt/oldest — wrong the moment two
 * subagents of one type ran at once. This suite drives three concurrent
 * `crew:coder`s through the hook route and checks every event lands on its
 * own row, and that payloads without `agent_id` still behave as before.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `hooks-agent-id-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");
const dbModule = require("../db");
const importHistory = require("../../scripts/import-history");

let server;
let BASE;

function fetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: { "Content-Type": "application/json", ...options.headers },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            parsed = body;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

const hook = (hook_type, data) =>
  fetch("/api/hooks/event", { method: "POST", body: { hook_type, data } });
const detail = async (sid) => (await fetch(`/api/sessions/${sid}`)).body;
const subsOf = (d) => d.agents.filter((a) => a.type === "subagent");
const byClaudeId = (d, cid) => d.agents.find((a) => a.claude_agent_id === cid);
// The Agent-spawn PreToolUse is attributed to the spawned row (as before), so
// tool counts filter by tool name.
const eventsOf = (d, agentId, type, tool) =>
  d.events.filter(
    (e) =>
      e.agent_id === agentId && (!type || e.event_type === type) && (!tool || e.tool_name === tool)
  );

const TRANSCRIPT = "/home/u/.claude/projects/-work-app/sess.jsonl";

/** Main dispatches `n` same-type subagents in one turn; each then starts. */
async function dispatch(sid, n, type = "crew:coder") {
  await hook("SessionStart", { session_id: sid, transcript_path: TRANSCRIPT });
  await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
  for (let i = 1; i <= n; i++) {
    await hook("PreToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_input: { subagent_type: type, description: `Lane ${i}`, prompt: `Lane ${i} — work` },
    });
  }
  for (let i = 1; i <= n; i++) {
    await hook("SubagentStart", {
      session_id: sid,
      transcript_path: TRANSCRIPT,
      agent_id: `a${i}`,
      agent_type: type,
    });
  }
}

before(async () => {
  server = await startServer(createApp(), 0);
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
});

describe("SubagentStart binds claude_agent_id", () => {
  it("binds dispatches to starts in order and derives the transcript path", async () => {
    const sid = "aid-bind";
    await dispatch(sid, 3);
    const d = await detail(sid);
    const subs = subsOf(d);
    assert.equal(subs.length, 3, "one row per dispatch, none added by SubagentStart");
    for (let i = 1; i <= 3; i++) {
      const row = byClaudeId(d, `a${i}`);
      assert.ok(row, `a${i} bound`);
      assert.equal(row.task, `Lane ${i} — work`, `a${i} bound to its own dispatch`);
      assert.equal(
        JSON.parse(row.metadata).transcript_path,
        path.join("/home/u/.claude/projects/-work-app", sid, "subagents", `agent-a${i}.jsonl`)
      );
    }
  });

  it("prefers agent_transcript_path when the hook carries it", async () => {
    const sid = "aid-tpath";
    await hook("SessionStart", { session_id: sid });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    await hook("PreToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer", prompt: "review" },
    });
    await hook("SubagentStart", {
      session_id: sid,
      agent_id: "r1",
      agent_type: "reviewer",
      agent_transcript_path: "/x/agent-r1.jsonl",
    });
    const row = byClaudeId(await detail(sid), "r1");
    assert.equal(JSON.parse(row.metadata).transcript_path, "/x/agent-r1.jsonl");
  });

  it("inserts a row when no Agent dispatch preceded the start", async () => {
    const sid = "aid-orphan";
    await hook("SessionStart", { session_id: sid });
    await hook("SubagentStart", { session_id: sid, agent_id: "z9", agent_type: "Explore" });
    const d = await detail(sid);
    const row = byClaudeId(d, "z9");
    assert.ok(row, "row created");
    assert.equal(row.subagent_type, "Explore");
    assert.equal(row.status, "working");
    assert.equal(row.parent_agent_id, `${sid}-main`);
  });

  it("re-opens a completed subagent when it is resumed", async () => {
    const sid = "aid-resume";
    await dispatch(sid, 1);
    await hook("SubagentStop", { session_id: sid, agent_id: "a1", agent_type: "crew:coder" });
    assert.equal(byClaudeId(await detail(sid), "a1").status, "completed");
    await hook("SubagentStart", { session_id: sid, agent_id: "a1", agent_type: "crew:coder" });
    const d = await detail(sid);
    assert.equal(byClaudeId(d, "a1").status, "working");
    assert.equal(subsOf(d).length, 1, "resume reuses the row");
  });
});

describe("tool events with agent_id land on their own row", () => {
  it("three concurrent same-type subagents, interleaved tools, stop by id", async () => {
    const sid = "aid-three";
    await dispatch(sid, 3);
    // Interleave: a2 first so the "deepest working" guess would be wrong.
    const seq = ["a2", "a1", "a3", "a3", "a2", "a1"];
    for (const [i, aid] of seq.entries()) {
      await hook("PreToolUse", {
        session_id: sid,
        agent_id: aid,
        agent_type: "crew:coder",
        tool_name: "Bash",
        tool_input: { command: `echo ${aid}-${i}` },
      });
      await hook("PostToolUse", {
        session_id: sid,
        agent_id: aid,
        agent_type: "crew:coder",
        tool_name: "Bash",
        tool_response: { stdout: "" },
      });
    }
    let d = await detail(sid);
    for (const aid of ["a1", "a2", "a3"]) {
      const row = byClaudeId(d, aid);
      const pre = eventsOf(d, row.id, "PreToolUse", "Bash");
      assert.equal(pre.length, 2, `${aid} has its two Bash PreToolUse`);
      assert.ok(
        pre.every((e) => JSON.parse(e.data).tool_input.command.startsWith(`echo ${aid}-`)),
        `${aid} only has its own commands`
      );
      assert.equal(eventsOf(d, row.id, "PostToolUse", "Bash").length, 2);
      assert.equal(row.status, "working");
    }
    assert.equal(eventsOf(d, `${sid}-main`, null, "Bash").length, 0, "nothing leaks onto main");
    const main = d.agents.find((a) => a.id === `${sid}-main`);
    assert.equal(main.current_tool, "Agent", "subagent tools do not touch main's current_tool");

    // Stop a2 alone (oldest heuristic would have picked a1).
    await hook("SubagentStop", {
      session_id: sid,
      agent_id: "a2",
      agent_type: "crew:coder",
      transcript_path: TRANSCRIPT,
    });
    d = await detail(sid);
    assert.equal(byClaudeId(d, "a2").status, "completed");
    assert.equal(byClaudeId(d, "a1").status, "working");
    assert.equal(byClaudeId(d, "a3").status, "working");
    const stop = eventsOf(d, byClaudeId(d, "a2").id, "SubagentStop");
    assert.equal(stop.length, 1);
  });

  it("a nested Agent dispatch from a bound subagent parents under it", async () => {
    const sid = "aid-nested";
    await dispatch(sid, 1);
    await hook("PreToolUse", {
      session_id: sid,
      agent_id: "a1",
      agent_type: "crew:coder",
      tool_name: "Agent",
      tool_input: { subagent_type: "Explore", prompt: "look" },
    });
    const d = await detail(sid);
    const outer = byClaudeId(d, "a1");
    const inner = subsOf(d).find((a) => a.subagent_type === "Explore");
    assert.ok(inner);
    assert.equal(inner.parent_agent_id, outer.id);
  });
});

describe("waiting inside a subagent", () => {
  it("stamps the asking subagent; its own tool event clears, another's keeps", async () => {
    const sid = "aid-wait";
    await dispatch(sid, 2);
    await hook("Notification", {
      session_id: sid,
      agent_id: "a1",
      agent_type: "crew:coder",
      message: "Claude needs your permission to use Bash",
    });
    let d = await detail(sid);
    assert.equal(d.session.awaiting_reason, "notification");
    assert.equal(byClaudeId(d, "a1").status, "waiting");
    assert.ok(byClaudeId(d, "a1").awaiting_input_since);
    assert.equal(byClaudeId(d, "a2").status, "working");
    assert.equal(d.agents.find((a) => a.id === `${sid}-main`).awaiting_input_since, null);

    // a2 keeps working — must not clear a1's prompt.
    await hook("PreToolUse", { session_id: sid, agent_id: "a2", tool_name: "Read" });
    d = await detail(sid);
    assert.equal(d.session.awaiting_reason, "notification", "other subagent keeps the wait");

    // The user approves; a1's tool completes.
    await hook("PostToolUse", { session_id: sid, agent_id: "a1", tool_name: "Bash" });
    d = await detail(sid);
    assert.equal(d.session.awaiting_input_since, null, "asker's own event clears");
    assert.equal(byClaudeId(d, "a1").status, "working");
    assert.equal(byClaudeId(d, "a1").awaiting_input_since, null);
  });
});

describe("payloads without agent_id keep the heuristic", () => {
  it("attributes to the deepest working subagent while main waits", async () => {
    const sid = "aid-legacy";
    await hook("SessionStart", { session_id: sid });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    await hook("PreToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer", prompt: "review" },
    });
    await hook("Stop", { session_id: sid });
    await hook("PreToolUse", { session_id: sid, tool_name: "Bash" });
    const d = await detail(sid);
    const sub = subsOf(d)[0];
    assert.equal(sub.claude_agent_id, null);
    assert.equal(eventsOf(d, sub.id, "PreToolUse", "Bash").length, 1);

    // Stop without an id still matches by type, and binds when an id is present.
    await hook("SubagentStop", { session_id: sid, agent_type: "reviewer", agent_id: "late" });
    const after = subsOf(await detail(sid))[0];
    assert.equal(after.status, "completed");
    assert.equal(after.claude_agent_id, "late");
  });
});

describe("JSONL backfill at SubagentStop", () => {
  it("merges agent-<id>.jsonl into the row bound to that id, not the nearest same-type start", async () => {
    const sid = "aid-jsonl";
    await dispatch(sid, 3); // a1, a2, a3: same type, started within one second
    const d = await detail(sid);
    const a1 = byClaudeId(d, "a1");
    const a2 = byClaudeId(d, "a2");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aid-jsonl-"));
    const file = path.join(dir, "agent-a2.jsonl");
    const ts = a1.started_at; // ties the heuristic on purpose
    fs.writeFileSync(
      file,
      [
        { type: "user", timestamp: ts, message: { content: [{ type: "text", text: "go" }] } },
        {
          type: "assistant",
          timestamp: ts,
          message: {
            model: "claude-sonnet-5",
            content: [{ type: "tool_use", id: "toolu_x", name: "Bash", input: { command: "ls" } }],
            usage: { input_tokens: 5, output_tokens: 5 },
          },
        },
        {
          type: "user",
          timestamp: ts,
          message: { content: [{ type: "tool_result", tool_use_id: "toolu_x", content: "ok" }] },
        },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n")
    );
    fs.writeFileSync(
      path.join(dir, "agent-a2.meta.json"),
      JSON.stringify({ agentType: "crew:coder" })
    );
    try {
      const data = await importHistory.parseSubagentFile(file);
      assert.equal(data.agentId, "a2");
      importHistory.importSubagentFromJsonl(dbModule, sid, `${sid}-main`, data);
      const after = await detail(sid);
      assert.equal(eventsOf(after, a2.id, "PreToolUse", "Bash").length, 1, "lands on a2's row");
      assert.equal(eventsOf(after, a1.id, "PreToolUse", "Bash").length, 0, "not on a1's");
      assert.equal(subsOf(after).length, 3, "no JSONL-keyed duplicate row");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("binding and stopping stay within type and id", () => {
  it("SubagentStart never binds a row of another type — it inserts one", async () => {
    const sid = "aid-type";
    await hook("SessionStart", { session_id: sid });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    await hook("PreToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_input: { subagent_type: "Explore", prompt: "look" },
    });
    await hook("SubagentStart", { session_id: sid, agent_id: "c1", agent_type: "crew:coder" });
    const d = await detail(sid);
    const explore = subsOf(d).find((a) => a.subagent_type === "Explore");
    assert.equal(explore.claude_agent_id, null, "the Explore row stays unbound");
    assert.equal(byClaudeId(d, "c1").subagent_type, "crew:coder");
    assert.equal(subsOf(d).length, 2);
    // a start of no recorded type binds only rows of no recorded type
    await hook("SubagentStart", { session_id: sid, agent_id: "x1" });
    const d2 = await detail(sid);
    assert.equal(subsOf(d2).find((a) => a.subagent_type === "Explore").claude_agent_id, null);
    assert.ok(byClaudeId(d2, "x1"));
  });

  it("a stop with an unknown id only considers unbound rows; a bound row is never completed by it", async () => {
    const sid = "aid-stop-unbound";
    await dispatch(sid, 1); // a1 bound
    await hook("PreToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_input: { subagent_type: "crew:coder", prompt: "unbound one" },
    });
    // a lightweight agent whose start was never seen stops
    await hook("SubagentStop", { session_id: sid, agent_id: "ghost", agent_type: "crew:coder" });
    let d = await detail(sid);
    assert.equal(byClaudeId(d, "a1").status, "working", "the bound row keeps running");
    assert.equal(byClaudeId(d, "ghost").task, "unbound one", "the unbound row took the stop");
    // nothing unbound left: an unknown id completes nothing
    await hook("SubagentStop", { session_id: sid, agent_id: "ghost2", agent_type: "crew:coder" });
    d = await detail(sid);
    assert.equal(byClaudeId(d, "a1").status, "working");
    assert.equal(byClaudeId(d, "ghost2"), undefined);
  });

  it("a completed bound row that runs a tool is reactivated (ended_at cleared)", async () => {
    const sid = "aid-react";
    await dispatch(sid, 1);
    await hook("SubagentStop", { session_id: sid, agent_id: "a1", agent_type: "crew:coder" });
    assert.ok(byClaudeId(await detail(sid), "a1").ended_at);
    await hook("PreToolUse", { session_id: sid, agent_id: "a1", tool_name: "Bash" });
    const row = byClaudeId(await detail(sid), "a1");
    assert.equal(row.status, "working");
    assert.equal(row.ended_at, null);
    assert.equal(row.current_tool, "Bash");
  });
});

describe("awaiting flags with bound subagents", () => {
  it("a bound sub's event clears its own flag; the session flag only when nobody is blocked", async () => {
    const sid = "aid-await";
    await dispatch(sid, 2);
    await hook("Notification", {
      session_id: sid,
      agent_id: "a1",
      message: "Claude needs your permission to use Bash",
    });
    await hook("Notification", {
      session_id: sid,
      agent_id: "a2",
      message: "Claude needs your permission to use Edit",
    });
    let d = await detail(sid);
    assert.equal(d.session.awaiting_reason, "notification");
    // a1 answered; a2 still blocks the session
    await hook("PostToolUse", { session_id: sid, agent_id: "a1", tool_name: "Bash" });
    d = await detail(sid);
    assert.equal(byClaudeId(d, "a1").awaiting_input_since, null);
    assert.ok(byClaudeId(d, "a2").awaiting_input_since, "a2's flag is untouched");
    assert.equal(d.session.awaiting_reason, "notification", "session still blocked by a2");
    // a2 stops without answering — its stop clears its flag and the session's
    await hook("SubagentStop", { session_id: sid, agent_id: "a2", agent_type: "crew:coder" });
    d = await detail(sid);
    assert.equal(byClaudeId(d, "a2").awaiting_input_since, null);
    assert.equal(d.session.awaiting_input_since, null);
  });

  it("a bound sub's event lifts a passive session wait but leaves main's own row flag", async () => {
    const sid = "aid-passive";
    await dispatch(sid, 1);
    await hook("Stop", { session_id: sid });
    let d = await detail(sid);
    assert.equal(d.session.awaiting_reason, "stop");
    await hook("PreToolUse", { session_id: sid, agent_id: "a1", tool_name: "Read" });
    d = await detail(sid);
    assert.equal(d.session.awaiting_input_since, null, "the session is active again");
    assert.equal(
      d.agents.find((a) => a.id === `${sid}-main`).awaiting_reason,
      "stop",
      "main is still idle"
    );
  });
});

describe("dropped dispatch hooks", () => {
  it("PostToolUse Agent describes the row SubagentStart had to insert", async () => {
    const sid = "aid-orphan-post";
    await hook("SessionStart", { session_id: sid });
    await hook("UserPromptSubmit", { session_id: sid, prompt: "go" });
    // the PreToolUse Agent never arrives
    await hook("SubagentStart", { session_id: sid, agent_id: "q1", agent_type: "crew:quick" });
    let row = byClaudeId(await detail(sid), "q1");
    assert.equal(row.task, null);
    await hook("PostToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_input: {
        subagent_type: "crew:quick",
        description: "Lane X",
        prompt: "Lane X — Smoke\nrun it",
        metadata: { k: 1 },
      },
      tool_response: { status: "started" },
    });
    row = byClaudeId(await detail(sid), "q1");
    assert.equal(row.name, "Lane X");
    assert.equal(row.task, "Lane X — Smoke\nrun it");
    assert.deepEqual(JSON.parse(row.metadata).k, 1);
    // a second PostToolUse Agent finds nothing to describe
    await hook("PostToolUse", {
      session_id: sid,
      tool_name: "Agent",
      tool_input: { subagent_type: "crew:quick", description: "other", prompt: "other" },
    });
    assert.equal(byClaudeId(await detail(sid), "q1").name, "Lane X");
  });

  it("a payload without agent_id in a session with bound rows is main's", async () => {
    const sid = "aid-main-actor";
    await dispatch(sid, 1);
    await hook("Stop", { session_id: sid }); // main waiting; a1 still working
    await hook("PreToolUse", {
      session_id: sid,
      tool_name: "Bash",
      tool_input: { command: "curl" },
    });
    const d = await detail(sid);
    assert.equal(eventsOf(d, `${sid}-main`, "PreToolUse", "Bash").length, 1, "lands on main");
    assert.equal(eventsOf(d, byClaudeId(d, "a1").id, "PreToolUse", "Bash").length, 0);
    assert.equal(d.agents.find((a) => a.id === `${sid}-main`).status, "working");
  });
});
