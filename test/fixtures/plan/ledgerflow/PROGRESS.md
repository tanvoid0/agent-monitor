# LedgerFlow build progress

Local tracker, gitignored. Source of truth for where the build stands; the plugin's `progress.json` is stale.
Curriculum: `D:/projects/production/plugins/learning-assistant/experiments/ledgerflow/` (`curriculum.json`, `steps/NN-*.json`).
Only the main thread edits this file; agents report, main thread ticks.

**Status (2026-09-15):** 17 / 32 steps done · milestone 2 of 7 closed · step 17 in progress (12 / 19 boxes).

## Milestones

### M1 — The money is correct + events between services ✅
- [x] 01 A service that runs
- [x] 02 Give it a real database
- [x] 03 Production shape
- [x] 30 The ledger itself
- [x] 04 Two services, and the pom.xml problem
- [x] 05 Make them talk
- [x] 06 Break it on purpose
- [x] 07 Your first event
- [x] 08 Turn it into a contract
- [x] 09 Consumers that survive

### M2 — Exactly once, numbers, observability ✅
- [x] 10 The dual-write bug — outbox
- [x] 11 At-least-once means duplicates — inbox
- [x] 12 A workflow across services — saga
- [x] 13 Read models and CQRS — Redis projection
- [x] 14 Observability — OTel → Grafana LGTM (`3237c3a`)

### M3 — Make it fast, model, README 🔶
- [x] 15 Make it fast, and prove it — outbox tick was the authorisation path (`bb0c0d9`)
- [x] 16 A model that never touches the ledger — scores beside the path, role cannot connect (`f8fb652`)
- [ ] 17 The repository someone actually reads — **current**

### M4 — What the broker actually promises
- [ ] 18 Partitions decide everything
- [ ] 19 The group, and the cost of changing it
- [ ] 20 Topics that forget, topics that remember
- [ ] 21 Kill a broker

### M5 — Work nobody is waiting for + containers
- [ ] 22 A job, and who starts it
- [ ] 23 A second job, and a schedule
- [ ] 24 When the batch fails at 3am
- [ ] 25 Every service in a container
- [ ] 26 Hand it to Kubernetes

### M6 — Batch at size
- [ ] 27 One job, every core
- [ ] 28 Jobs that branch, and jobs that stop
- [ ] 29 Workers on other machines

### M7 — Nobody gets in
- [ ] 31 Nobody gets in without a token
- [ ] 32 Know what you ship

## Current step: 17 — The repository someone actually reads

Done when: A clean clone reaches a working demo with one command, the README opens with the problem and the numbers,
and three decision records show your reasoning rather than your conclusions.

Decisions taken before the lanes (keep consistent):
- The demo is `scripts/demo.sh`: compose `--wait`, topics + schema registration (Redpanda has no volume), `./mvnw -q -T1C package -DskipTests`,
  `scripts/start-services.sh` (eight jars in the background, health-polled, logs under `.local/logs/` which is gitignored), then three
  scenario scripts that print what happened. Seed data already ships in account-service's Flyway (`V2__seed.sql`, `V4__opening_balances.sql`),
  so there is no `seed.sh`. Ollama is optional: without it the fraud scenario shows a template case note and says so.
- Three ADRs exist (`0001-outbox-over-cdc`, `0002-read-your-own-writes`, `0003-k6-over-jmeter`). The step asks for outbox-vs-CDC (have),
  orchestration-vs-choreography for the capture flow (new `0004`, the step-12 saga decision) and where the risk model sits (new `0005`).
  One record gets a `## What I would revisit` line that admits something real.
- CI = one workflow `ci.yml` running `./mvnw -B -T1C verify` on `ubuntu-latest` with Temurin 25; `schema-check.yml` stays as it is.
  Local wall time is measured first; if verify passes ten minutes, the ITs are what gets trimmed, never a coverage gate added.
- The walkthrough video is the user's to record (Win+Alt+R or OBS); the repo ships the script that drives it and a written
  `docs/walkthrough.md` the README links from the top. The video link is filled in when it exists.
- Waves: 1: A · I · D (3 agents) → 2: C inline, CI green → 3: W (user, optional).

### Lane D — Demo · serial · one agent
_touches: `scripts/demo.sh`, `scripts/start-services.sh`, `scripts/stop-services.sh`, `scripts/scenario-*.sh`, `scripts/walkthrough.sh`, `.gitignore` (`.local/` is already there), README "Run it" section only, `docs/perf/*step17*.json` + generated `docs/perf/README.md`. Owns the stack: the only lane that starts, stops or loads it_
- [x] D1 `scripts/start-services.sh` + `scripts/stop-services.sh`: start the eight jars from `services/*/target/*-1.0.0-SNAPSHOT.jar` in the background with logs in `.local/logs/<service>.log` and pids in `.local/pids`, poll `/actuator/health` on 8080–8087 until UP (fail after 90 s naming the service and the last log lines); stop reads the pid file; both refuse loudly if a port is already taken (`ss`/`netstat` or a `curl` probe before starting)
- [x] D2 `scripts/scenario-authorize-capture.sh`: one payment through `POST :8085/api/v1/payments`, polls the GET until `Captured`, prints each state it saw with timestamps and the trace id (the `X-Request-Id`), and the wallet's balance before and after from `:8083`; `scripts/scenario-insufficient-funds.sh`: a payment larger than the wallet holds → `Failed` with `WALLETS_UNAVAILABLE`, balance unchanged; `scripts/scenario-fraud-flagged.sh` = `replay-fraud.sh` trimmed to the demo (10-payment burst + `mule-1`), prints the REVIEW/BLOCK counts, the first case note and whether it was `gemma4` or `template`, and that every saga still captured
- [x] D3 `scripts/demo.sh` exactly as the step's block, with the topic loop + `scripts/check-schemas.sh --register` between compose and the build, `set -euo pipefail`, and the first lines checking `docker info`, `java -version` ≥ 25 and the eight ports free — each failure a one-line message and exit 1; README "Run it" collapses to `scripts/demo.sh` + `scripts/stop-services.sh`, the per-terminal `spring-boot:run` lines go
- [ ] D4 clean-clone proof on this machine (C1 is committed as `9aeb874`, so run it now): `scripts/stop-services.sh`, `docker compose -f infra/compose/docker-compose.yml down -v` (dev data goes; `pg_stat_statements` was created by hand and needs re-creating if wanted), then `rm -rf /tmp/lf-clean && git clone -q . /tmp/lf-clean && cd /tmp/lf-clean && ./scripts/demo.sh` from the committed tree (stash nothing: commit D1–D3 first via C1, or run against `HEAD` after `git stash`? — no: ask the main thread to commit C1 before D4); wall time and the full output → `.local/work/d-clean-clone.md`
- [ ] D5 `scripts/walkthrough.sh`: the four beats of the step's "What to show" block with a `read -p` pause between them, printing the Grafana Explore/Tempo URL for the trace it just made (`http://localhost:3000/explore?...` with the trace id) so the recorder only has to paste it
- [ ] D6 checkpoint from the clean clone's stack: `export PATH="/c/Program Files/k6:$PATH"; perf/bench.sh step17` → three `step17` JSONs + regenerated `docs/perf/README.md`; then stop the `/tmp/lf-clean` services, bring the repo's own stack back up with `scripts/demo.sh` (proves it twice) → `.local/work/d-report.md`

### Lane A — README top + ADRs · parallel · one agent
_touches: `README.md` (first 60 lines + a `## Walkthrough` link, not "Run it"), `docs/adr/0001-outbox-over-cdc.md`, `docs/adr/0004-orchestration-over-choreography.md`, `docs/adr/0005-risk-model-beside-the-path.md`, `docs/walkthrough.md`_
- [x] A1 README top, read cold: first sentence says what the system is (the step's block: double-entry ledger, holds/capture/refund, services by events, no distributed transaction, no path for the model to money), the measured table stays the first section, then a one-line pointer to the properties table; `test $(wc -l < README.md) -ge 40 && head -40 README.md | grep -qi ledgerflow`; nothing about the curriculum, ever
- [x] A2 `docs/adr/0004-orchestration-over-choreography.md`: context (step-12 capture flow across ledger, issuer, settlement), options (choreography by events; orchestration by a saga in payment-service), decision (orchestration: `PaymentSaga` sealed states, per-step deadline, compensations), consequence (one place to read the flow, one service that must be up, replies as a contract), `## What I would revisit`
- [x] A3 `docs/adr/0005-risk-model-beside-the-path.md`: context (a model on the money path makes its latency and outage yours), options (call the model in the saga; score the stream and only record), decision, consequence (decisions recorded, not enforced — the veto needs a fourth saga reply; the role and ArchUnit as the two controls), numbers from `docs/measurements/step-16-risk.md`
- [x] A4 `docs/adr/0001-outbox-over-cdc.md` gets `## What I would revisit` with the step-15 numbers (the tick was the authorisation path; where polling stops paying) — the one that admits something; `test $(ls -1 docs/adr/*.md | wc -l) -ge 3`
- [x] A5 `docs/walkthrough.md`: the four beats, what to look at in each (trace in Tempo, the ledger summing to zero, the case note), one screenshot placeholder per beat; README gets `## Walkthrough` near the top linking it (`grep -c walkthrough README.md` ≥ 1) with a "video: coming" line the user replaces

### Lane I — CI · parallel · one agent
_touches: `.github/workflows/ci.yml` only; measures with `./mvnw` locally, pushes nothing_
- [x] I1 `.github/workflows/ci.yml` as the step's block (`actions/checkout@v4`, `setup-java@v4` temurin 25 with maven cache, `./mvnw -B -T1C verify`), plus `timeout-minutes: 15` and `concurrency` cancelling superseded runs on the same ref; `schema-check.yml` untouched
- [x] I2 local timing: `time ./mvnw -B -T1C verify` on this machine with the stack DOWN (Testcontainers needs the ports; coordinate with D — run it before D starts or after D6) → `.local/work/i-timing.md` with the wall time and the slowest three modules from the surefire/failsafe reports; if over ten minutes locally, name which ITs to move behind a profile and why — do not do it yet
- [ ] I3 after C pushes: `gh run list --limit 1 --json conclusion --jq '.[0].conclusion' | grep -qx success`; if red, read the log with `gh run view --log-failed` and report — the fix is a C box

### Lane W — Walkthrough · optional · user
_touches: `docs/walkthrough.md` (the video link), README (`## Walkthrough` line)_
- [ ] W1 record ~90 s with `scripts/walkthrough.sh` on the left and Grafana on the right (Win+Alt+R or OBS), upload wherever, paste the link into both files

### Lane C — Commit · inline · main thread
_touches: git index. Prose titles; no AI attribution_
- [x] C1 commit D1–D3 + I1 (scripts + Run it + ci.yml) before D4: "One command from clone to a running system, and a workflow that runs the tests that would catch a bug"; push → CI runs
- [x] C2 commit A1–A5: "Three decisions written down, one of them admitting something"
- [ ] C3 commit D5–D6 + `docs/perf/*step17*` + README.md: "The step 17 numbers"
- [ ] C4 I3 green; tick 17 under Milestones (M3 closes); Status line; expand step 18 into lanes; delete `.local/work/`; memory

## Next up
18 — Partitions decide everything. Read `steps/18-*.json`, expand into lanes before starting.
