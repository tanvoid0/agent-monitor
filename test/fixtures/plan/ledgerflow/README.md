# ledgerflow plan fixture

Snapshot of the ledgerflow v2 board (`ledgerflow/.local/board.py`, ADR 0001) taken 2026-09-15T14:09:01.245Z, mid step 17
with one `crew:coder` live on lane D. This is the acceptance contract for `server/plan/**` (spec: `docs/plan-layer.md` §5).

| file | from | notes |
|---|---|---|
| `PROGRESS.md` | `ledgerflow/PROGRESS.md` | verbatim |
| `log.md` | `ledgerflow/.local/log.md` | verbatim |
| `events.jsonl` | `ledgerflow/.local/events.jsonl` | verbatim except `transcript` paths, rewritten to `transcripts/…` relative to this directory |
| `transcripts/**` | `~/.claude/projects/D--projects-practice-microservices-ledgerflow/**` | **trimmed to `type: "assistant"` lines** — the only lines either tailer reads (model, usage, text blocks). Raw files were 13.9 MB of other sessions' tool output. |
| `now.txt` | `model.now` from `GET :8099/api/model` | the instant the model was built; every relative age in `expected/*` is against this |
| `expected/summary.txt` | `GET :8099/api/summary` | verbatim |
| `expected/wip.txt` | `GET :8099/api/wip` | verbatim; v2 has no `$` column — CCAM's adds one |
| `expected/model.json` | `GET :8099/api/model` | prettier-formatted, same `now` as the two text files |

Two referenced subagent transcripts no longer existed on disk when the snapshot was taken and are absent here too, so
v2 and the fixture agree on them (no model/ctx for those agents):

- `transcripts/66f2a6f0-6592-46ca-99fb-057bdc9072b7/subagents/agent-a4bcf559653f823e2.jsonl`
- `transcripts/66f2a6f0-6592-46ca-99fb-057bdc9072b7/subagents/agent-a58512390105378f7.jsonl`

`"transcript": "C:/x/y.jsonl"` in the selftest lines is deliberate — it never existed.

Consistency proof: `/api/model` was fetched before the file copy and again after `/api/summary` and `/api/wip`; both
carried the same `now`, so no rebuild happened between the copy and the recorded text.
