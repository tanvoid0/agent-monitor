---
name: hook-setup
description: >
  Inspect and install AgentMonitor monitoring hooks for Claude Code and Codex. Use when
  onboarding a provider, repairing missing hooks, checking which provider is
  active, or validating that installation preserved unrelated user hooks.
---

# Hook Setup

1. Inspect current state: `am hooks status`.
2. Show which provider hooks are missing or will be replaced.
3. Install only after confirmation:

```bash
am hooks install <selected-or-missing-providers> --yes
```

Replace the placeholder with `claude`, `codex`, or `claude codex` based on the
user's selected scope and the missing providers reported by `am hooks status`.

4. Read back `am hooks status`.
5. Start a real provider session and verify a new session/event reaches AgentMonitor.

Installers replace only AgentMonitor-owned entries and preserve unrelated hooks.
Hook execution must remain fail-safe and non-blocking.
