# Plan layer — a plan-joined build board on top of Claude-Code-Agent-Monitor

- Status: proposed, 2026-09-15
- Decider: Tanveer Hoque
- Base: fork of [hoangsonww/Claude-Code-Agent-Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) at
  `3a7630b` (v2.2.0, 2026-09-13). This working tree has it as remote `upstream`.
- Supersedes: `ledgerflow/.local/adr/0001-agent-board.md` (v2) and `ledgerflow/.local/board-spec.md`, which stay as the
  record of how the per-repo board was built and what was measured.

## 1. Decision

Fork CCAM. Keep everything it already does — sessions, agents, events, tokens and cost, waiting badges, WebSocket
push, SQLite, the React UI, the Electron shell, the hook installer — and add one thing on top: **the plan join**.
A project's `PROGRESS.md` (milestones → steps → lanes → boxes) becomes a page where every box shows the agent on it,
what it ran, what failed, what it cost; and a text API the main thread reads instead of the files.

Why fork rather than build (the earlier draft said build): the requirement is a proper UI and a database, across every
project. CCAM has both, plus a year of edge cases in hook ingestion and transcript parsing we would otherwise
re-discover. What it lacks is exactly one domain, ours, and that domain is additive.

Why it is viable — checked in the source, not the README:

| we need | CCAM has | where |
|---|---|---|
| every project, every session | hooks installed in `~/.claude/settings.json`; `sessions.cwd` | `scripts/install-hooks.js`, `server/db.js:163` |
| subagents with their prompt | `agents` row per `Agent` dispatch; `agents.task` = first 500 chars of the prompt — `Lane X — name` is in there | `server/routes/hooks.js:418-456` |
| tool events with I/O | `events(session_id, agent_id, event_type, tool_name, summary, data)` | `server/db.js:195` |
| tokens and $ | `token_usage` per session × model; `model_pricing`; `transcript-cache.js` extracts `tokensByModel` from any transcript path | `server/db.js:208,243`, `server/lib/transcript-cache.js` |
| waiting-for-user | `agents.status = 'waiting'`, `Notification` + `UserPromptSubmit` hooks | `server/routes/hooks.js:52-106` |
| live push | `broadcast(type, data)` server side, `useWebSocket(onMessage)` client side | `server/websocket.js:62`, `client/src/hooks/useWebSocket.ts:79` |
| a place for a page | react-router `Routes` in `App.tsx`, nav array in `Sidebar.tsx`, components (`StatusBadge`, `AgentCard`, `Skeleton`, `EmptyState`, `StatCard`) | `client/src/App.tsx:126-141`, `client/src/components/Sidebar.tsx:99` |
| tests without a framework | `node --test server/__tests__/*.test.js`; client vitest | `package.json` |

And the gap that is not additive, found in `server/routes/hooks.js`:

> "Subagent tool_use blocks never fire hooks on the parent session — this scan is the only path that attributes them
> to the subagent's agent_id." (`hooks.js:1224` at v2.2.0; the §4.1 patch rewords that comment)

That was true once; it is not now. `PreToolUse`/`PostToolUse` fire inside subagents and carry `agent_id` +
`agent_type` (probed 2026-09-15, Claude Code 2.1.238 — ledgerflow ADR 0001). CCAM does not read `data.agent_id` on
tool hooks, does not install `SubagentStart`, gives each subagent its own `uuidv4()`, attributes live tool events to
the "deepest working agent" and matches `SubagentStop` by name prefix → `subagent_type` → prompt → oldest working.
With three `crew:coder`s on three lanes that is wrong while they run and repaired only by the JSONL scan at stop. The
plan join needs it right live. So the fork carries **one patch in upstream files** (§4.1), written so it can go
upstream as a pull request — it is a bug there too — and the rest lives in new files.

## 2. Fork strategy — keep the pull open

- `upstream` = hoangsonww; `origin` = the fork. Track upstream release tags; rebase `master` (upstream's default branch; there is no `main`) onto each.
- Everything of ours lives under `server/plan/`, `server/routes/plans.js`, `client/src/plan/`, `docs/plan-layer.md`,
  `test/fixtures/plan/`. Upstream files are touched in exactly the places listed in §6 — a one-line require, a
  one-line `app.use`, a route, a nav item, a locale block, one migration, and the ingest patch.
- The ingest patch is opened upstream as a PR the week it lands. Once merged, the diff in upstream files is six lines.
- Not renamed, not rebranded. `ccam` stays `ccam`; the plan page is a page.

## 3. Start using it today — before any code

```bash
# on GitHub: fork hoangsonww/Claude-Code-Agent-Monitor under tanvoid0 (the user does this; it creates a public repo)
cd D:/projects/production/ai/agentic-ai/agent-monitor
git remote add origin git@github.com:tanvoid0/Claude-Code-Agent-Monitor.git
npm install                    # Node ≥ 22.22 (24.14 here); node:sqlite, no native build
npm run build                  # client → dist
node scripts/install-hooks.js  # writes the hook block into ~/.claude/settings.json — every project from now on
npm start                      # http://localhost:4820
```

From that moment: every session in every project, its agents, tool events, waiting state, tokens and $ — the
Dashboard, Sessions, Activity and Analytics pages. That already replaces the Agents and Activity panels of the v2 board.
Ledgerflow's own hooks keep running beside it until §8; both write, nothing collides (different files, different ports).

## 4. What we add

### 4.1 The ingest patch (upstream files)

1. `scripts/install-hooks.js:87-94` — add `SubagentStart` to `HOOKS_WITHOUT_MATCHER`. It carries `agent_id`,
   `agent_type`, `session_id`, and the subagent transcript is on disk ~100 ms before it fires.
2. `server/db.js` migration — `ALTER TABLE agents ADD COLUMN claude_agent_id TEXT` + index. Pattern at `db.js:557`,
   but placed **after** the legacy `agents_new` rebuild (`db.js:1113-1171`), which enumerates columns explicitly and
   would drop a column added before it on a legacy-CHECK database.
3. `server/routes/hooks.js`:
   - `SubagentStart`: bind. Find the **oldest** `working` subagent in the session with `claude_agent_id IS NULL`,
     same `subagent_type` first (else any unbound) — FIFO, because a batched dispatch fires its `Agent` hooks 1,2,3 and
     its `SubagentStart`s 1,2,3, and most-recent would bind them reversed; set `claude_agent_id`; record the transcript path in
     `metadata.transcript_path` (from `agent_transcript_path`, or derived `<dir of transcript_path>/<session_id>/subagents/agent-<id>.jsonl`).
     No unbound row (a dispatch the `Agent` hook missed) → insert one. A resumed subagent fires `SubagentStart`
     again (fixture: `a41bd1302af678ba7` at 13:35 and 13:37) and is already bound → reactivate the row.
   - `PreToolUse` / `PostToolUse` / `Notification` with `data.agent_id`: attribute to the row with that
     `claude_agent_id`. Only when absent fall back to today's deepest-working heuristic. (`PostToolUseFailure` is not
     in `HOOKS_WITH_MATCHER` at `install-hooks.js:87`, so it never arrives; the attribution is generic and would cover
     it if installed. `Notification` waiting stamps the asking subagent's row instead of main when `agent_id` names
     one; the session flag still drives the badge.)
   - `SubagentStop` with `data.agent_id`: match by `claude_agent_id` first; the four heuristics stay as fallback.
   - The JSONL scan at stop stays — it back-fills anything the hooks missed and older sessions.
4. Tests: `server/__tests__/hooks-agent-id.test.js` — three concurrent subagents of the same type, tool events
   interleaved, each lands on its own row; stop matches by id.

~140 lines net, half of them comments. This is the PR. Named in its text but left alone (§6):
`scripts/import-history.js:774 findLiveSubagentForJsonl` still matches a JSONL to a live row by type + start-time
tolerance at the stop scan; a `WHERE claude_agent_id = ?` first try there would make it exact.

### 4.2 Data

Two tables, in `server/plan/schema.js`, created from one call added to `db.js`'s init:

```sql
CREATE TABLE IF NOT EXISTS plans (
  cwd        TEXT PRIMARY KEY,           -- the project; sessions.cwd joins here
  slug       TEXT NOT NULL UNIQUE,       -- basename of cwd; parent-basename on collision; never changes once set
  source     TEXT NOT NULL,              -- PROGRESS.md as last read
  parsed     TEXT NOT NULL,              -- JSON: milestones, stories, lanes, tasks (structure + ticks only)
  step       INTEGER,                    -- ## Current step: N
  mtime      TEXT NOT NULL,
  step_since TEXT,                      -- when this step number was first seen; the step's event window opens at
                                        -- the earlier of this and the step's first plan_log line
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS plan_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cwd        TEXT NOT NULL REFERENCES plans(cwd) ON DELETE CASCADE,
  step       INTEGER NOT NULL,           -- the step the line belongs to; keys repeat across steps
  key        TEXT NOT NULL,              -- R5.1, or a lane letter
  agent      TEXT NOT NULL,              -- label: crew:coder, a lane letter, an id suffix, main
  status     TEXT NOT NULL CHECK(status IN ('start','done','blocked','note')),
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_log_cwd_step ON plan_log(cwd, step);
```

What stays a file: **`<cwd>/PROGRESS.md`** — the plan is authored as markdown because a main thread expanding a step
writes twenty boxes in markdown far better than in twenty API calls. Writers: the main thread (expanding a step) and
the server (`tick` flips a checkbox). Agents never. **`.local/log.md` is retired**: box-level lines go to `plan_log`
through `POST /api/plans/:slug/log`. A `<cwd>/.local/log.md` that exists is imported read-only (same grammar) so a
project mid-flight keeps its history.

Discovery: no registration. The watcher (`server/plan/watcher.js`, `fs.watch` with a 2 s stat fallback, the pattern
of `server/lib/cc-watcher.js`) checks `<cwd>/PROGRESS.md` for every distinct `sessions.cwd` seen in the last 7 days;
present → upsert `plans`, watch the file; changed → re-parse, `broadcast("plan_updated", {slug})`.

### 4.3 Grammar — unchanged from v2

```
**Status (2026-09-15):** 16 / 32 steps done · milestone 2 of 7 closed · step 16 in progress (26 / 33 boxes).
## Milestones
### M1 — Name ✅
- [x] 01 Step title (`3237c3a`)          ← optional commit hash in backticks anywhere on the line
- [ ] 16 Step title — **current**
## Current step: 16 — Title
Done when: …(one paragraph; ends at the first blank line)…
Decisions taken before the lanes (keep consistent):
- …(markdown until the first ### Lane)…
### Lane R — risk-service · parallel · one agent
_touches: `services/risk-service/**`, `pom.xml`_
- [x] R1 box text (markdown inline)
- [ ] R5 box text
  - [ ] R5.1 subtask                      ← two spaces per level; key = parent key + "." + n; any depth
## Sandbox: Board dry run                 ← zero or more; parsed like a step, kind = "sandbox"
Done when: …
### Lane X — Dry run · optional · main
- [ ] X1 …
## Next up
```

Lane heading parts after `·` are tags; one is the mode: `serial | parallel | inline | optional`. Parser:
`server/plan/parser.js`, a port of `board.py`'s, tested against the ledgerflow fixture.

### 4.4 The join — `server/plan/join.js`

Input: `plans.parsed` + `plan_log` for the current step + CCAM's `sessions`, `agents`, `events` for that `cwd` +
per-agent transcript figures. Output: the v2 model shape (below), computed on request, cached per `cwd` until any
input changes (a `sessions`/`agents`/`events` write for that cwd, a `plan_log` insert, a plan re-parse, a transcript
mtime).

- **agent → lane**: `agents.task` begins `Lane X` → lane `X`, title after `—`; else the dispatching `Agent` event's
  `tool_input.prompt` (`events.data`) in the same session, first unclaimed match; else `null`. `story` = the story
  owning that letter (current step first, then sandboxes). Main thread (`agents.type = 'main'`) is lane `C` when the
  step has one.
- **task status**: ticked → `done`; else by its last `plan_log` line: `done` → `reported`, `blocked` → `blocked`,
  `start`/`note` → `doing`; else `todo`. Parent with children: `done` only if ticked; else `blocked` if any child is,
  `doing` if any child is doing/reported, else its own. Counts include every depth.
- **task agent / times**: label of the `start` line (else `done`); a label matches an agent when it equals
  `subagent_type`, the lane letter, `claude_agent_id` or its last five chars, or `main`. `started` = first `start`
  (or the agent's `started_at` when the lane's agent is working and the task is `doing` with no lines);
  `finished` = last `done`; `ms` accordingly.
- **tool attribution**: the `start` for KEY by label L opens a window closing at L's next later line that is another
  key's `start` or this key's `done`/`blocked`; `events` rows with `event_type = 'PreToolUse'` by a matching agent on
  that lane inside the window count (`tools`; `errors` = the paired `PostToolUse` with `data.is_error`,
  `tool_response.interrupted`, or a non-empty `tool_response.stderr` — CCAM has no `PostToolUseFailure` event type).
  v2 compares its second-precision log timestamps against ms event timestamps as strings, so its per-task `tools`
  miss the start second and include the end second; ours are numerically right (model-only; summary/wip unaffected).
- **live**: v2's rule — `agents.status = 'working'` (or `'waiting'` with `awaiting_reason = 'notification'`) **and**
  last activity within 30 min (subagents) / 10 min (main). Status alone is wrong: imported mains stay `working`
  forever. Per-agent status is correct after §4.1. `waiting` = `agents.status = 'waiting'` with the `Notification`
  payload's kind and tool.
- **per-agent figures** (`server/plan/tail.js`, the v2 tailer): from `metadata.transcript_path` (subagents) or
  `sessions.transcript_path` (main) — `transcriptCache.extract()` for `tokensByModel`/`latestModel`; our own tail for
  `ctx` (latest message's input + cache_creation + cache_read), `window` (200k, or 1M once exceeded), `ctxPct`, and
  `say` (last assistant text block, ≤ 300 chars). `out`/`calls` count the **first** record per `message.id` (v2's
  rule; `tokens out: 477119` only reproduces that way — CCAM's cache keeps the last record, which gives 697k across
  the fixture). `cost` = `tokensByModel` × `model_pricing` — CCAM's table, CCAM's
  rates, so the plan page and the Analytics page agree to the cent.

Model (`GET /api/plans/:slug/model`, WS `plan_model`):

```jsonc
{"now": "iso",
 "project": {"slug": "ledgerflow", "cwd": "D:/…/ledgerflow", "step": 17},
 "status": {"date": "…", "text": "…"}, "steps": {"done": 16, "total": 32, "current": 17},
 "milestones": [{"id": "M1", "title": "…", "done": true, "steps": [{"num": "01", "title": "…", "done": true, "current": false, "commit": "3237c3a"}]}],
 "stories": [{"id": "step-17", "kind": "step", "num": 17, "title": "…", "doneWhen": "…", "decisions": "<md>",
   "counts": {"done": 5, "reported": 1, "doing": 1, "blocked": 0, "todo": 12, "total": 19},
   "lanes": [{"letter": "D", "name": "Demo", "tags": ["serial"], "mode": "serial", "touches": "<md>", "counts": {…},
     "agents": ["<ccam agent id>"], "live": "<id>" | null,
     "tasks": [{"key": "D1", "text": "…", "depth": 0, "ticked": false, "status": "doing",
                "agent": "crew:coder", "agentId": "<id>", "started": "iso", "finished": null, "ms": 123456,
                "tools": 14, "errors": 0, "note": "…", "log": [{"ts": "iso", "agent": "crew:coder", "status": "start", "note": "…"}],
                "children": []}]}]}],
 "agents": {"<ccam id>": {"id": "…", "claudeId": "…", "type": "crew:coder", "session": "66f2a6f0", "sessionId": "<full ccam session id>", "lane": "D",
   "story": "step-17", "title": "Demo", "start": "iso", "stop": null, "live": true,
   "waiting": {"kind": "permission", "tool": "Bash", "since": "iso"} | null, "say": "…" | null,
   "lastTs": "iso", "lastTool": "Bash", "last": "<cmd or file>", "tools": 33, "errors": 0, "box": "D1",
   "model": "claude-sonnet-5", "ctx": 58000, "ctxPct": 29, "out": 4321, "cost": 1.87}},
 "totals": {"agents": 3, "live": 1, "waiting": 0, "tools": 220, "errors": 2, "cost": 4.10, "sessions": ["66f2a6f0"]}}
```

### 4.5 Routes — `server/routes/plans.js`, mounted at `/api/plans`

| route | behaviour |
|---|---|
| `GET /` | projects with a plan: slug, cwd, step, counts, live agents, last event age (JSON; `?format=text` one line each) |
| `GET /:slug/model` | the model |
| `GET /:slug/summary` | **text/plain** ≤ 25 lines: `project: ledgerflow` · status · per lane: `lane D Demo · serial · 0/6 · live crew:coder@54a7d (sonnet 5, ctx 52%) on D1 · WAITING permission Bash · last: <cmd 80> (3s ago)` — v2-exact, no `$` (the `$` lives in `wip` and `agent`) · `blocked:` · `reported (awaiting tick):` · `next:` |
| `GET /:slug/next[?n=3]` | text: Done-when, then the next `n` todo tasks per lane |
| `GET /:slug/wip` | text: live agents — id suffix, type, model, ctx%, $, lane, box, elapsed, waiting, `say:` line, last 3 commands with ms and `ERR`. v2 plus `$` in the tag and the `say:` line |
| `GET /:slug/lane/:X` · `/:slug/task/:key` · `/:slug/agent/:id` | text, as v2 |
| `POST /:slug/tick` `{"key","done"}` | flips the checkbox in `<cwd>/PROGRESS.md` (first match, any indent), rewrites `(N / M boxes)` in the Status line, re-parses, answers with the summary. 404 unknown key. The UI's checkbox calls the same route |
| `POST /:slug/log` `{"agent","key","status","note"}` | inserts a `plan_log` row for the current step; `broadcast("plan_log", …)` |
| `POST /:slug/export` `{"dir","prompts": true}` | writes `index.html` (the v2 snapshot page, kept at `server/plan/snapshot.html`), `model.json`, `events.jsonl` (last 5000 events of the project, v2 line shape; `agent` carries the CCAM agent id — the page keys `model.agents` by it — `type: "main"` still marks mains) into `dir` and answers with the exact `Artifact(...)` call. The Artifact tool reads only cwd/scratchpad, hence a directory the caller names |
| every text route | `?format=json` |

Text rules: one fact per line, no tables, no headers, `hh:mm:ss` absolute, `12s ago`/`3m`/`1.2h` relative, ≤ 60 lines
except `task` and `agent`. If `tokenGuard` is armed (`DASHBOARD_API_TOKEN` in CCAM's settings) the skill passes the
header; by default it is not.

WS messages (through `broadcast`): `plan_updated {slug}` (re-parse), `plan_model {slug, model}` (debounced 300 ms,
at least every 5 s while any agent on the plan is working), `plan_log {slug, row}`.

### 4.6 Page — `client/src/plan/`, route `/plan/:slug?`

The v2 page in CCAM's components and Tailwind, one route, one nav item (`nav:plan`, icon `SquareKanban` — lucide-react 0.474 dropped the `KanbanSquare` name):

- **Project picker** (top bar): `GET /api/plans`, live/waiting badges, last-used remembered in `localStorage`.
- **Stories rail** (left): milestones → steps → lanes, current step expanded, counts per lane, mode chip.
- **Board** (centre): columns To do · Doing · Reported · Done, cards = boxes with agent badge (type · model · ctx% · $),
  nested subtask tree, amber border + `waiting · permission · Bash` chip, `say` line on the live card's agent.
  Checkbox on a card → `POST tick`.
- **Agents** (right, collapsible): one row per agent on this plan — badge, ctx meter, $, lane, box, elapsed, last command,
  swimlane timeline of tool ticks (d3 is already a dependency) — deferred past 0.1.0: the model carries only
  per-agent aggregates; the timeline needs a per-event slice the routes do not expose yet.
- **Detail** (drawer): breadcrumb `Step 17 › Lane D › D1`, status, text, log lines, attributed tool events with
  stdout/stderr tails (from `events.data`), link to the CCAM session page (`/sessions/:id`; CCAM has no per-agent
  route) — the deep dive is already built.
- Strings in `client/src/i18n/locales/<xx>/plan.json` for **all five locales** — the repo's i18n-parity rule and
  `bash .claude/skills/i18n-parity/scripts/i18n-audit.sh` require every namespace file in every locale dir with the
  same keys (an `en`-only file fails the audit), and Surface 4 of that audit greps `client/src/i18n/index.ts` for
  every namespace — so `plan` is registered there like every other namespace (five imports, five `plan: plan_xx`
  resource lines, one `ns` entry; additive). Runtime `addResourceBundle` registration was tried first and can never
  pass the audit.
- 400 px: rail and agents collapse into drawers; board scrolls.

Dark/light follows CCAM's theme. No new theming.

### 4.7 The skill and the per-project file

`docs/plan-layer-skill.md` is the block a project's `CLAUDE.local.md` carries (or a `board` skill in the tanvoid0
marketplace that says the same — decide when the second project adopts it):

- board up? `curl -s localhost:4820/api/plans` — else `npm start` in the fork (or open the desktop app).
- session start: `curl -s localhost:4820/api/plans/<slug>/summary`; before dispatch: `/next`; while running: `/wip`;
  one thing: `/lane/X`, `/task/KEY`, `/agent/ID`.
- tick, main thread only, the turn the report lands: `curl -s -XPOST localhost:4820/api/plans/<slug>/tick -H 'content-type: application/json' -d '{"key":"R3","done":true}'`.
- publish a snapshot: `POST export` with the session's scratchpad dir, then the `Artifact(...)` it prints with the
  project's artifact `url`.
- lane prompts begin `Lane X — <name>`; they end with, verbatim, `<agent>` filled in:
  > When a box is finished: `curl -s -XPOST localhost:4820/api/plans/<slug>/log -H 'content-type: application/json' -d '{"agent":"<agent>","key":"<KEY>","status":"done","note":"<what passed or what was measured>"}'`.
  > If a box cannot be finished, post `"status":"blocked"` with the reason and move on. Do not touch `PROGRESS.md`.
- expanding a step: the grammar of §4.3; lanes by disjoint file sets; modes; ≤ 4 agents; boxes name a file or a command.

## 5. Build plan

Three lanes plus the main thread; never more than four agents. `board-spec.md`'s rules and the ledgerflow fixture are
the contract; the v2 server's `/api/summary` and `/api/wip` output for that fixture is the acceptance text.

**Fixture (main thread, first):** `test/fixtures/plan/ledgerflow/` — `PROGRESS.md`, `log.md`, the v2 `events.jsonl`
translated into `sessions`/`agents`/`events` rows (a seed script, `test/fixtures/plan/seed.js`), the referenced
subagent transcripts with paths rewritten, `now.txt`, `expected/summary.txt`, `expected/wip.txt`. As built
(2026-09-15, `test/fixtures/plan/ledgerflow/README.md`): every transcript the events name — main sessions too — is
included, **trimmed to `type: "assistant"` lines** (all either tailer reads; 13.9 MB → 5.2 MB); two step-16 subagent
transcripts were already gone from disk and are absent on both sides.

### Lane S — ingest patch + server · serial · `crew:coder` on **opus**
_touches: `scripts/install-hooks.js`, `server/routes/hooks.js`, `server/db.js` (two lines), `server/index.js` (two lines), `server/plan/**`, `server/routes/plans.js`, `server/__tests__/plan-*.test.js`, `server/__tests__/hooks-agent-id.test.js`_

- [ ] S1 §4.1 patch; `hooks-agent-id.test.js` green; existing `npm run test:server` still green
- [ ] S2 `server/plan/schema.js` + the init call; `server/plan/parser.js` reproduces the fixture's structure (counts per lane; the fixture has no nested task, so depth is covered by an inline sample in `plan-parser.test.js`)
- [ ] S3 `server/plan/watcher.js` — discovery from `sessions.cwd`, upsert, re-parse on change, `plan_updated`
- [ ] S4 `server/plan/join.js` + `tail.js` — `summary` for the seeded fixture equals `expected/summary.txt`
- [ ] S5 `server/routes/plans.js` — every route in §4.5; `wip` equals `expected/wip.txt` once the `$` and `say:` additions are stripped; the `$` is asserted present, not pinned (upstream bumps `model_pricing` regularly; it read `$2.77` at the snapshot)
- [ ] S6 WS: `plan_model` debounce + 5 s tick while working; `plan_log`
- [ ] S7 `export` writes the three files; `snapshot.html` (v2 page) renders them
- [x] S8 upstream PR text for S1 in `docs/upstream-pr-agent-id.md` — diff, the probe, the three-concurrent test (`36d40e8` is part of the PR)

### Lane P — page · parallel · `crew:coder` on sonnet
_touches: `client/src/plan/**`, `client/src/App.tsx` (one route), `client/src/components/Sidebar.tsx` (one item), `client/src/i18n/locales/*/plan.json` (five, new), `client/src/i18n/locales/*/nav.json` (`nav:plan`, five one-liners), `client/src/i18n/index.ts` (namespace registration), `client/src/plan/__tests__/**`_

- [ ] P1 `Plan.tsx` renders `expected/model.json` from a mock fetch: rail, board, agents, detail — screenshot beside the v2 page
- [ ] P2 picker + route param + `localStorage`
- [ ] P3 WS subscription (`plan_model`, `plan_log`, `plan_updated`) through `useWebSocket`
- [ ] P4 tick checkbox → `POST tick`; optimistic flip, revert on 4xx
- [ ] P5 waiting chips, `say` line, `$` on badges/lanes/totals
- [ ] P6 400 px; dark + light; `npm run test:client` green

### Lane D — docs, skill, fixture glue · parallel · `crew:coder` on sonnet (`crew:quick` refuses three-plus files; this lane touches eight)
_touches: `docs/plan-layer-skill.md`, `docs/PLUGINS.md` (one section), `README.md` (one section + screenshot slot) mirrored into `README-CN.md`, `README-VN.md`, `README-KO.md`, `README-ES.md` (repo rule), `test/fixtures/plan/seed.js`_

- [ ] D1 `seed.js`: v2 `events.jsonl` → CCAM rows (the mapping table in a comment)
- [ ] D2 `plan-layer-skill.md` per §4.7; the ledgerflow `CLAUDE.local.md` replacement block
- [ ] D3 README + PLUGINS sections; CHANGELOG entry under a `plan` heading

### Main thread
- fixture, then dispatch S and P and D together; D finishes first, P needs S5 for the live test, S is the long pole
- after S7 + P6: smoke — hooks installed, ledgerflow open, one `Lane X —` subagent dispatched, the box goes `doing`
  with the right agent within 2 s, an `AskUserQuestion` shows amber and clears, `/api/plans/ledgerflow/summary`
  equals v2's `/api/summary` line for line
- commit per lane as it lands (on `master`); tag `plan-0.1.0` on the fork
- gate baseline on Windows, 2026-09-15, before any plan code: server 1211 tests / 4 fail (`ccam-cli.test.js:463`
  subprocess exit `0xC0000409`, `codex-process-overlay.test.js:104` and `remote-sources.test.js:157` expect POSIX
  paths, `codex-sweep-perf.test.js:30` EPERM on temp rm); client 470 / 3 fail (`screens.snapshot` renders `13:00:00`
  where the baseline has `1:00:00 PM` — machine locale). All platform-only; "green" here means no new failures

**Done when:** the fork runs from `npm start`, hooks are global, the ledgerflow plan renders with correct live
attribution under three concurrent subagents, the text API reproduces v2 for the fixture, `npm test` is green
including upstream's suite, and the PR for §4.1 is open upstream.

## 6. Touchpoints in upstream files — the merge budget

| file | change | lines |
|---|---|---|
| `scripts/install-hooks.js:94` | `SubagentStart` in `HOOKS_WITHOUT_MATCHER` | 1 |
| `server/db.js` ~`:1171`, ~`:1401` | `claude_agent_id` migration (comment + try/catch + index); `require("./plan/schema").init(db)` | 13 + 3 |
| `.prettierignore` | `server/plan/snapshot.html` (the v2 page, kept verbatim) | 1 |
| `server/routes/hooks.js` | §4.1 bind + attribute + stop-by-id | ~70 |
| `server/index.js:73,105` | `require("./routes/plans")`; `app.use("/api/plans", plansRouter)` | 2 |
| `client/src/App.tsx:129` | `<Route path="plan/:slug?" element={<Plan />} />` | 2 |
| `client/src/components/Sidebar.tsx:99` | `{ to: "/plan", icon: SquareKanban, key: "nav:plan" }` + import | 2 |
| `client/src/i18n/index.ts` | `plan` namespace: five imports, five resource lines, one `ns` entry | 11 |
| `client/src/components/DocumentTitle.tsx` | `/plan` → `nav:plan` tab title (the route map lives there) | 2 |
| `scripts/import-history.js` ~`:774` | stop-time JSONL back-fill tries `claude_agent_id` before the type + start-time heuristic (part of the §4.1 PR) | ~6 |
| `client/src/i18n/locales/*/nav.json` | `nav:plan` (five locales, parity rule) | 5 × 1 |

Everything else is a new file. After the upstream PR merges, the `hooks.js` line count goes to zero.

## 7. Ceilings, named

- Attribution is only as good as §4.1: until it lands, live tool events under concurrent subagents are heuristic (as
  upstream today). The fixture test is the guard.
- Generation time is invisible; `say` is the last text that landed.
- `plan_log` lines posted while the server is down are lost; the log is optional refinement, the hook stream is the
  signal. `.local/log.md` import covers a project that wants a file.
- `tick` writes `PROGRESS.md` while the main thread may be editing it by hand (expanding a step). Same race as v2;
  the rule is: expand first, then dispatch, then tick.
- The artifact is a snapshot. The desktop app or a hosted CCAM (its `DEPLOYMENT.md`) is the live board.
- One Node process per hook (CCAM's fire-and-forget handler, ~50 ms); ledgerflow's Python hooks double it until §8.
  Hooks get dropped under load — the live smoke lost a dispatch's `PreToolUse Agent` while a test suite ran. The
  `SubagentStart` row insert and the `PostToolUse Agent` back-fill cover a missed dispatch hook; a missed
  `SubagentStart` falls back to the heuristics until the stop-time scan.
- Errors are invisible live: `PostToolUseFailure` is not installed, so a failed call has no post event until the
  stop-time JSONL scan writes `data.is_error`. Adding it to `HOOKS_WITH_MATCHER` is a one-line upstream follow-up.
- Events while the server is down land in whichever step is in force when it comes back; `plans.step_since` and
  the step's first `plan_log` line anchor the window, nothing else can.
- FIFO binding assumes the `Agent` hooks and the `SubagentStart`s arrive in the same order. Same-type parallel
  dispatches whose hooks cross bind name/task swapped for the run (events still 1:1); the stop-time scan repairs it.
- Two projects with the same basename get `parent-basename` slugs; a renamed directory is a new project.
- Keys must not repeat across a step and a sandbox that are open at once.

## 8. Cutover for ledgerflow — at the step 17 → 18 boundary

1. Fork running on 4820; hooks installed globally; ledgerflow's plan discovered (it has a `PROGRESS.md`).
2. Import history: `node test/fixtures/plan/seed.js --from D:/…/ledgerflow/.local/events.jsonl --cwd D:/…/ledgerflow` —
   old agents and events land in the DB; `.local/log.md` is imported by the watcher.
3. Compare `/api/plans/ledgerflow/summary` with `localhost:8099/api/summary`. Identical → continue.
4. Remove the `hooks` block from `.claude/settings.local.json`; stop `board.py`.
5. `CLAUDE.local.md`: replace the reading/ticking/publishing blocks with `docs/plan-layer-skill.md`'s block, the slug
   and the artifact URL. Lane prompts' closing paragraph becomes the `POST log` form.
6. `.local/`: delete `board.py`, `hooks/`, `progress.html`, `model.json`, `events.jsonl`; keep `log.md` (history),
   `adr/`, `board-spec.md`.
7. Republish through `export`; the artifact URL is unchanged.

## 9. Not doing

Rebranding the fork; a second UI beside CCAM's; native task tools as the plan; PermissionRequest-based approvals from
the page (the desktop app has that UI; if wanted later, CCK's `approval-gate.sh` design is the reference — gate on
`PermissionRequest`, not `PreToolUse`); Codex plans; a hosted mode of our own.

## 10. Defaults chosen — flip before Lane S starts

- Fork, not a plugin. (The standalone-plugin draft was discarded 2026-09-15; §1 keeps its survey. If the fork stalls,
  the v2 server in `ledgerflow/.local/board.py` is the fallback, ported to Node behind the same routes.)
- Log lines in the DB via API; the file is import-only.
- Slug from the cwd basename.
- Snapshot page = the v2 HTML, unchanged, fed by `export`.
