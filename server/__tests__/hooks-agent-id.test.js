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
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const http = require("http");

const TEST_DB = path.join(os.tmpdir(), `hooks-agent-id-${Date.now()}-${process.pid}.db`);
process.env.DASHBOARD_DB_PATH = TEST_DB;
process.env.DASHBOARD_LIVENESS_PROBE = "0";

const { createApp, startServer } = require("../index");

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
