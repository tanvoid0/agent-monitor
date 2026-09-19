---
description: AgentMonitor platform status across hooks, config, updates, and MCP prerequisites
---

Run `am health`, `am hooks status`, `am config claude overview`,
`am config codex overview`, and `am update-check`. Note that
`am update-check` runs `git fetch --prune`, so it updates local Git metadata
without changing working-tree files. Also check whether `mcp/build/index.js`
exists. Report exact provider hook state, configuration roots, dashboard
version, and MCP build readiness. Do not modify configuration or install hooks.
