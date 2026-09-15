# Upstream PR — bind subagent rows to Claude Code's `agent_id`

Target: `hoangsonww/Claude-Code-Agent-Monitor`, base `master` (v2.2.0, `3a7630b`).
Source commits on this fork: `2edf5a9` + `36d40e8` (hooks part only). Open it the day `origin` exists:

```bash
git checkout -b fix/hooks-bind-claude-agent-id 3a7630b
git cherry-pick 2edf5a9 36d40e8   # 36d40e8 also touches README*/ARCHITECTURE/server-README — keep them, they document the change
git push -u origin fix/hooks-bind-claude-agent-id
gh pr create --repo hoangsonww/Claude-Code-Agent-Monitor --base master --title "fix(hooks): bind subagent rows to Claude Code's agent_id via SubagentStart" --body-file docs/upstream-pr-agent-id.md
```

The body below the rule is the PR description.

---

## Summary

Tool hooks fired inside a subagent carry `agent_id` and `agent_type`, and `SubagentStart` fires with the same id
once the subagent's transcript exists. The ingest path read neither: each `Agent` dispatch got a `uuidv4()` row, live
`PreToolUse`/`PostToolUse` went to the "deepest working" subagent, and `SubagentStop` matched by name prefix → type →
prompt → oldest working. With two subagents of one type running at once, live attribution was wrong until the
stop-time JSONL scan repaired it. This binds the row to the id at `SubagentStart` and routes by it afterwards.
Payloads without `agent_id` (older Claude Code, main-agent hooks) take the existing path unchanged.

## The probe

Claude Code 2.1.238, three `crew:coder` subagents dispatched in one turn, `PreToolUse` payloads captured from inside
each subagent:

```json
{"hook_event_name":"PreToolUse","session_id":"66f2a6f0-…","agent_id":"a4bcf559653f823e2","agent_type":"crew:coder","tool_name":"Bash", …}
```

`SubagentStart` for the same agent, fired ~100 ms after
`~/.claude/projects/<proj>/<session>/subagents/agent-a4bcf559653f823e2.jsonl` appeared on disk:

```json
{"hook_event_name":"SubagentStart","session_id":"66f2a6f0-…","agent_id":"a4bcf559653f823e2","agent_type":"crew:coder", …}
```

`SubagentStop` carries the same `agent_id`. Main-agent hooks carry none. The comment at `hooks.js:1224` ("Subagent
tool_use blocks never fire hooks on the parent session") described an older Claude Code.

## Changes

- `scripts/install-hooks.js` — `SubagentStart` joins `HOOKS_WITHOUT_MATCHER` (ninth hook type).
- `server/db.js` — `agents.claude_agent_id TEXT` + `idx_agents_claude_id(session_id, claude_agent_id)`, placed after
  the legacy `agents_new` rebuild so a legacy-CHECK database keeps the column.
- `server/routes/hooks.js`
  - `SubagentStart` binds the **oldest unbound working** row of the same type (or no type), `started_at, rowid`
    order — a batched dispatch fires its `Agent` hooks and its `SubagentStart`s in the same order. Records
    `metadata.transcript_path` from `agent_transcript_path` or the `<dir>/<session>/subagents/agent-<id>.jsonl`
    layout. No unbound row → insert one (the `Agent` hook was dropped). Already bound → the subagent was resumed →
    reactivate.
  - `PreToolUse` / `PostToolUse` / `Notification` / `SubagentStop` with `agent_id` → the bound row. A `Notification`
    wait stamps the asking subagent; its own next tool event clears it, another subagent's does not; the session
    flag drops only when no agent still holds a notification wait.
  - `SubagentStop` with an id that matches no row keeps the four heuristics to **unbound** rows — lightweight
    agents (no `Agent` dispatch, `agent_type` absent) were completing a bound coder mid-run.
  - `PostToolUse` for `Agent` back-fills name/task/metadata on a `SubagentStart`-inserted row: hooks are
    fire-and-forget and a dispatch's `PreToolUse` was lost under load in a live run; the `PostToolUse` 2 ms later
    carries the same `tool_input`.
  - A payload **without** `agent_id` in a session that already has a bound subagent is the main agent (that Claude
    Code version stamps ids on subagent hooks). Before: main's tool events landed on the deepest working subagent
    whenever main was `waiting` after its previous `Stop`, and main's own notification wait never cleared until the
    next user prompt.
  - The stop-time JSONL scan stays as the back-fill; its comment is reworded.
- `scripts/import-history.js` `findLiveSubagentForJsonl` — tries `claude_agent_id` (the id is in the file name) before
  the type + start-time heuristic, which tied three same-type rows started within one second.
- `server/openapi.js` — hook list, `data.agent_id` / `agent_type`, `Agent.claude_agent_id`. README (five languages),
  `ARCHITECTURE.md`, `server/README.md` name the ninth hook.

`hooks.js` +283/−47 including comments; `import-history.js` +11; `db.js` +16.

## Tests — `server/__tests__/hooks-agent-id.test.js` (16)

- binds dispatches to starts in order and derives the transcript path
- prefers `agent_transcript_path` when the hook carries it
- inserts a row when no `Agent` dispatch preceded the start
- re-opens a completed subagent when it is resumed
- **three concurrent same-type subagents, interleaved tools, stop by id** — each lands on its own row
- a nested `Agent` dispatch from a bound subagent parents under it
- stamps the asking subagent; its own tool event clears, another's keeps
- attributes to the deepest working subagent while main waits (payloads without `agent_id`, unchanged behavior)
- merges `agent-<id>.jsonl` into the row bound to that id, not the nearest same-type start
- `SubagentStart` never binds a row of another type — it inserts one
- a stop with an unknown id only considers unbound rows; a bound row is never completed by it
- a completed bound row that runs a tool is reactivated (`ended_at` cleared)
- a bound sub's event clears its own flag; the session flag only when nobody is blocked
- a bound sub's event lifts a passive session wait but leaves main's own row flag
- `PostToolUse Agent` describes the row `SubagentStart` had to insert
- a payload without `agent_id` in a session with bound rows is main's

Full suite on Windows: 1260 tests, 1254 pass; the 4 failures predate this branch (`ccam-cli.test.js:463` subprocess
exit `0xC0000409`, `codex-process-overlay.test.js:104` and `remote-sources.test.js:157` expect POSIX paths,
`codex-sweep-perf.test.js:30` EPERM on temp rm).

## Ceilings, stated

- FIFO binding assumes the `Agent` hooks and the `SubagentStart`s arrive in the same order. Same-type parallel
  dispatches whose hooks cross get name/task swapped for the run (tool events stay 1:1 with the right id); the
  stop-time scan repairs it.
- `PostToolUseFailure` is not installed, so a failed tool call has no live post event; the JSONL scan writes
  `data.is_error` at stop. Adding it to `HOOKS_WITH_MATCHER` is a one-line follow-up.
- Existing installs need `npm run install-hooks` again to receive `SubagentStart`; until then a subagent's first
  tool hook with `agent_id` matches no row and the old heuristics run.
