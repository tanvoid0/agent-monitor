---
name: config-explorer
description: >
  Inspect and safely edit the Claude Code and Codex configuration surfaces
  exposed by AgentMonitor. Use when auditing skills, agents, commands, plugins,
  marketplaces, MCP servers, hooks, settings, memory, keybindings, profiles,
  rules, or instruction files, and when a backup-backed allowlisted edit is
  required.
---

# Config Explorer

## Claude Code

Read with:

```bash
am config claude overview
am config claude skills --scope user
am config claude agents --plugins
am config claude agents-usage
am config claude mcp
am config claude hooks
am config claude memory
```

Supported writes are limited to text artifacts and keybindings. Use a JSON file
and `--yes`. Every write or delete creates a timestamped backup.

## Codex

Read with:

```bash
am config codex overview
am config codex read /absolute/path
```

Use `edit` only for the server's unredacted editable allowlist. Supported writes
and deletes are backup-backed. Base `config.toml` is edit-only. Profiles are
created with `am config codex profile <name> --yes`.

Never overwrite a redacted preview. Read the editable source before saving.
Never edit plugin or MCP state files outside the server's allowlist.
