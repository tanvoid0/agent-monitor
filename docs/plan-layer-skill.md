# Plan layer skill

Paste the block below into a project's `CLAUDE.local.md` in place of its own board-reading / ticking / publishing
sections — this is the cutover described in [docs/plan-layer.md](./plan-layer.md) §8 step 5. Fill in `<slug>` (the
project's `cwd` basename — list every known project and its slug with `GET /api/plans`) and `<artifact url>` (the
URL a prior `Artifact(...)` call returned for this project's snapshot; the first `export` call prints a fresh one).
Everywhere below assumes the fork is running on its default port, 4820 (`npm start`, or the desktop app) — the fork
owns hooks globally from `docs/plan-layer.md` §3 onward, not a per-project `board.py`.

## Reading the plan (cheap) instead of the files (expensive)

The server answers in plain text sized for one tool call. Use it before reading `PROGRESS.md` or the database:

- board up? `curl -s localhost:4820/api/plans` — else `npm start` in the fork (or open the desktop app)
- session start / "where are we": `curl -s localhost:4820/api/plans/<slug>/summary`
- before dispatching a lane: `curl -s localhost:4820/api/plans/<slug>/next?n=3` (Done-when + the next todo tasks per
  lane — this is the plan of action)
- while agents run: `curl -s localhost:4820/api/plans/<slug>/wip` (live agents only: lane, current box, last
  commands, errors, elapsed, model, context %, cost)
- one lane / one task / one agent: `curl -s localhost:4820/api/plans/<slug>/lane/X`,
  `curl -s localhost:4820/api/plans/<slug>/task/KEY`, `curl -s localhost:4820/api/plans/<slug>/agent/ID`
- machine form: add `?format=json` to any of the above; the whole thing at once:
  `curl -s localhost:4820/api/plans/<slug>/model`

Read `PROGRESS.md` itself only to edit it (expanding a step, writing decisions) or when the API says something you
need to verify against the file.

## Ticking

- Only the main thread ticks, the turn a lane's report lands — not at the end of the session:
  `curl -s -XPOST localhost:4820/api/plans/<slug>/tick -H 'content-type: application/json' -d '{"key":"R3","done":true}'`.
  The server flips the checkbox in `PROGRESS.md`, rewrites the Status line's box count, re-parses, and answers with
  the summary — you never hand-edit the file for a tick.
- Step complete: tick the step under Milestones, run the step's own checkpoint (e.g. `perf/bench.sh stepNN`), update
  the **Status** line, expand the next step, then publish (below).

## Publishing a snapshot

- After every tick (or a step expansion), republish so the page stays current: `POST` to
  `localhost:4820/api/plans/<slug>/export` with `{"dir": "<this session's scratchpad dir>", "prompts": true}` — a
  directory under your own cwd/scratchpad, since the `Artifact` tool only reads there. It writes `index.html`,
  `model.json`, and `events.jsonl` into that directory and answers with the exact `Artifact(...)` call to run,
  carrying `<artifact url>` (the same URL on every republish once one has been minted).

## Agent log and lane prompts

- Every lane prompt **begins** with `Lane X — <lane name>` on its first line — the join reads that line to put the
  agent's work on the lane (`docs/plan-layer.md` §4.4). No other convention.
- Box-level state is optional and self-reported by the agent, straight to the database — no file:
  `POST localhost:4820/api/plans/<slug>/log`. `"status":"done"` shows as Reported on the board until the main
  thread ticks it.
- Lane prompts end with this paragraph, verbatim, `<agent>` filled in:
  > When a box is finished: `curl -s -XPOST localhost:4820/api/plans/<slug>/log -H 'content-type: application/json' -d '{"agent":"<agent>","key":"<KEY>","status":"done","note":"<what passed or what was measured>"}'`.
  > If a box cannot be finished, post `"status":"blocked"` with the reason and move on. Do not touch `PROGRESS.md`.

## Expanding a step into lanes

Unchanged from before the fork — the grammar of `docs/plan-layer.md` §4.3. Group boxes into lanes by disjoint file
sets, one lane per agent, heading `### Lane X — Name · <mode> · <who>` with a `_touches: …_` line naming the files.
Modes: `serial` (needs the stack under load — at most one such lane per step), `parallel` (safe alongside anything),
`optional`, `inline` (main thread, e.g. commits). Max 4 agents at once; boxes name a file or a command, not an idea.

---

## ledgerflow CLAUDE.local.md replacement block

Per `docs/plan-layer.md` §8 step 5: this replaces ledgerflow's `CLAUDE.local.md` intro paragraph and its
`## Reading the board`, `## Ticking`, and `## Agent log (\`.local/log.md\`) and the lane prompt` sections. Its
`## Expanding a step into lanes` and `## Never` sections are untouched — `board.py`/`.local/hooks/` are removed
separately at §8 step 6, but the two file-convention sections that survive it stay put.

```markdown
# Progress tracking (local, never committed)

`PROGRESS.md` is where the build stands. Read it at session start. The live board renders it:
https://claude.ai/artifact/1BMUASrvJX45WrPFCaxfD5 — republished by `export` below, never edited by hand.
The dashboard (CCAM, this repo's board layer) is at http://localhost:4820 — hooks in `~/.claude/settings.json`
feed it globally, no per-project setup. Design, probe results and ceilings: `.local/adr/0001-agent-board.md`
(superseded record); current contract: `docs/plan-layer.md` in the agent-monitor fork.

## Reading the plan (cheap) instead of the files (expensive)
The server answers in plain text sized for one tool call. Use it before reading `PROGRESS.md`:
- board up? `curl -s localhost:4820/api/plans` — else `npm start` in the fork (or open the desktop app)
- session start / "where are we": `curl -s localhost:4820/api/plans/ledgerflow/summary`
- before dispatching: `curl -s localhost:4820/api/plans/ledgerflow/next?n=3` — this is the plan of action
- while agents run: `curl -s localhost:4820/api/plans/ledgerflow/wip`
- one lane / one task / one agent: `curl -s localhost:4820/api/plans/ledgerflow/lane/R`,
  `curl -s localhost:4820/api/plans/ledgerflow/task/R5.1`, `curl -s localhost:4820/api/plans/ledgerflow/agent/<id suffix>`
- machine form: add `?format=json`; the whole thing: `curl -s localhost:4820/api/plans/ledgerflow/model`
Read the files themselves only to edit them (expanding a step, writing decisions) or when the API says something
you need to verify.

## Ticking
- Only the main thread ticks `PROGRESS.md`; agents report, the main thread ticks when the report lands, in the
  same turn — not at the end of the session:
  `curl -s -XPOST localhost:4820/api/plans/ledgerflow/tick -H 'content-type: application/json' -d '{"key":"R3","done":true}'`
  (fixes the Status line's box count and answers with the summary).
- After every tick, republish the board in the same turn so the page stays current: `POST` to
  `localhost:4820/api/plans/ledgerflow/export` with `{"dir": "<scratchpad dir>", "prompts": true}`, then run the
  `Artifact(...)` call it answers with (carries `url="https://claude.ai/artifact/1BMUASrvJX45WrPFCaxfD5"`).
- Step complete: tick the step under Milestones, run `perf/bench.sh stepNN`, update the **Status** line, expand
  the next step, republish.

## Agent log and the lane prompt
- Every lane prompt **begins** with `Lane X — <lane name>` on its first line; the join reads that line to put the
  agent on the lane. No other convention.
- Box-level state is optional and self-reported, straight to the dashboard, no file:
  `POST localhost:4820/api/plans/ledgerflow/log`. `done` → Reported on the board until the main thread ticks.
- Lane prompts end with this paragraph, verbatim, `<agent>` filled in:
  > When a box is finished: `curl -s -XPOST localhost:4820/api/plans/ledgerflow/log -H 'content-type: application/json' -d '{"agent":"<agent>","key":"<KEY>","status":"done","note":"<what passed or what was measured>"}'`.
  > If a box cannot be finished, post `"status":"blocked"` with the reason and move on. Do not touch `PROGRESS.md`.
```
