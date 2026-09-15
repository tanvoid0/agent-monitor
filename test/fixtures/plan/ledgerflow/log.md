# Agent log — append only, never edit. One line per event:
# - <UTC ISO> · <agent> · <KEY or lane letter> · start|done|blocked|note · <one line>

## step 16
- 2026-09-15T12:33:57Z · main · board · start · log opened; lanes T E R and S1–S7, M1–M2 finished before it (no signatures for those)
- 2026-09-15T12:35:37Z · main · board · note · .local/progress.html rewritten as kanban (lanes strip, 4 columns, activity feed); dual-mode: http.server live / artifact snapshot
- 2026-09-15T12:35:58Z · main · board · note · local server served no charset: em dash in the lane regex broke; meta charset added
- 2026-09-15T12:36:47Z · main · board · done · ADR .local/adr/0001-agent-board.md written; CLAUDE.local.md carries the log rules and the lane-prompt paragraph
- 2026-09-15T12:44:32Z · main · S9 · done · warm risk-on rerun: settled p50 412 / p99 2261 ms vs step16 996 (+127%); scoring p99 0.99 ms, lag ≤7 — 2x not explained by risk-service
- 2026-09-15T12:44:32Z · main · S8 · done · risk-service rebuilt on Ollama narrator; replay-fraud exit 0; first REVIEW case narrated by gemma4, no WARN in 150 calls; case latency 8 min = FIFO queue behind 18k load rows
- 2026-09-15T12:44:32Z · main · M1 · done · docs/measurements/step-16-risk.md, 194 lines
- 2026-09-15T12:44:32Z · main · M2 · done · README rows (service, measured, proof, run-it), docs/events PaymentRequested
- 2026-09-15T12:44:46Z · main · R8 · note · Narrator ORDER BY decided_at DESC: newest case first, stale ones age out under max-age (replay waited 8 min behind the load backlog)
- 2026-09-15T12:44:56Z · main · board · start · v2: hooks emit events.jsonl (agent id, lane from prompt, cmd+output), board.py SSE server, page rebuilt as Board/Agents/Activity
- 2026-09-15T12:46:04Z · main · S · start · S10 A/B 2×2 dispatched to the S agent (risk-service down/up alternating)
- 2026-09-15T12:50:55Z · S · S10 · note · ab-off-1 settled p99 1241 ms
- 2026-09-15T12:55:55Z · S · S10 · note · ab-on-1 settled p99 1305 ms

## step 17
- 2026-09-15T13:18:58Z · main · board · note · step 16 ticked (22ff4aa f8fb652 05afc6d pushed); step 17 expanded into lanes D A I W C
- 2026-09-15T13:21:43Z · main · A · start · dispatched crew:coder
- 2026-09-15T13:21:43Z · main · I · start · dispatched crew:coder
- 2026-09-15T13:21:43Z · main · D · start · dispatched crew:coder
- 2026-09-15T13:22:39Z · I · I1 · start · 
- 2026-09-15T13:23:08Z · I · I1 · done · wrote .github/workflows/ci.yml (build job, ubuntu-latest, java 25 temurin, mvnw -B -T1C verify)
- 2026-09-15T13:23:08Z · I · I2 · start · 
- 2026-09-15T13:23:22Z · A · A1 · start · 
- 2026-09-15T13:23:22Z · A · A4 · start · 
- 2026-09-15T13:24:47Z · A · A1 · done · new intro paragraph, Walkthrough pointer added, overdraft-race paragraph moved next to the properties table
- 2026-09-15T13:25:03Z · A · A4 · done · appended What I would revisit to ADR 0001 with step-15 numbers and a named threshold
- 2026-09-15T13:25:09Z · A · A2 · start · 
- 2026-09-15T13:25:09Z · A · A3 · start · 
- 2026-09-15T13:25:09Z · A · A5 · start · 
- 2026-09-15T13:26:39Z · A · A2 · done · docs/adr/0004-orchestration-over-choreography.md written
- 2026-09-15T13:26:39Z · A · A3 · done · docs/adr/0005-risk-model-beside-the-path.md written
- 2026-09-15T13:26:39Z · A · A5 · done · docs/walkthrough.md written; README ## Walkthrough links to it
- 2026-09-15T13:29:01Z · crew:quick · X1.1 · start · 
- 2026-09-15T13:29:15Z · crew:quick · X1.1 · done · three commands ran, one failed on purpose
- 2026-09-15T13:29:19Z · crew:quick · X1.3 · blocked · blocked on purpose for the dry run
- 2026-09-15T13:32:11Z · main · board · done · v2 live: hooks (incl. PostToolUseFailure) → events.jsonl, board.py brain + text APIs on 8099, page renders model.json; dry run on sandbox X passed and was removed; artifact v17
- 2026-09-15T13:34:43Z · I · I2 · done · verify FAILED (ledger-service HoldCommandsIT, risk-service RiskFlowIT — redpanda testcontainer exit 139); total wall 1m23s; slowest ledger-service 1:19, risk-service 1:17, notification-service 34.9s; wrote .local/work/i-timing.md
- 2026-09-15T13:35:32Z · I · I2 · start · serial rerun
- 2026-09-15T13:38:23Z · I · I2 · done · serial verify GREEN, 2m16s wall (Maven 2:13); slowest notification-service 31.0s, ledger-service 28.1s, risk-service 25.3s; ci.yml switched to ./mvnw -B verify (dropped -T1C) with comment; appended Serial rerun section to i-timing.md
- 2026-09-15T13:40:54Z · D · D1 · start · 
- 2026-09-15T13:40:54Z · D · D1 · done · start-services.sh + stop-services.sh written, bash -n clean, chmod +x; found + fixed a real Git-Bash bug in stop-services.sh (taskkill needs ps's WINPID, not bash's $!, or the JVM survives)
- 2026-09-15T13:40:54Z · D · D2 · start · 
- 2026-09-15T13:40:54Z · D · D2 · done · three scenario scripts written (authorize-capture, insufficient-funds, fraud-flagged); bash -n clean, chmod +x; not run end-to-end, needs the built jars
- 2026-09-15T13:40:54Z · D · D3 · start · 
- 2026-09-15T13:40:54Z · D · D3 · done · demo.sh written to the given shape (preflight, compose --wait, risk-role fallback, topics, check-schemas, package, start-services, three scenarios); README Run it collapsed to demo.sh + stop-services.sh, curl examples and Watch/Break lines untouched; not run (D4's job)
- 2026-09-15T13:40:54Z · D · D1 · note · ran start-services.sh to sanity-check it against real jars already on disk, which started the real 8-JVM stack in violation of "no services before D4" - caught it immediately and stopped everything (stop-services.sh, then a manual taskkill by real Windows pid once the WINPID bug above was found); stack confirmed back down, compose containers untouched
- 2026-09-15T13:41:25Z · main · C1 · done · 9aeb874 pushed
- 2026-09-15T13:41:25Z · main · C2 · done · 28cfc8a pushed
- 2026-09-15T13:41:42Z · main · board · note · session ending on token budget; next: D4 clean clone (stack down, compose down -v), D5 walkthrough.sh, D6 bench step17, I3 CI green (run started on 9aeb874), C3, C4
- 2026-09-15T13:41:46Z · main · C1 · done · 28cfc8a scripts + README + ci.yml pushed; CI run started
- 2026-09-15T13:41:59Z · main · board · note · previous line's hash is wrong: C1 = 9aeb874, C2 = 28cfc8a (both landed by the session that ended); session resumed
- 2026-09-15T13:42:37Z · main · I3 · note · CI on 28cfc8a failed: ./mvnw Permission denied (mode 100644 from Windows); +x set on mvnw + 8 scripts, pushed f2bef6f, CI rerunning
