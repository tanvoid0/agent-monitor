#!/usr/bin/env node
/**
 * @file upgrade.js
 * @description `npm run upgrade` — reinstall AgentMonitor from the current
 * checkout, printing each step like `am doctor` so the operator sees the old
 * install being removed and the new one taking its place. Steps: optional
 * `git pull --ff-only` (`--pull`), unlink the previous global CLI (including
 * the pre-rebrand `agent-dashboard` package name), `npm run setup`,
 * `npm run build`, reinstall hooks (`--claude` by default, `--codex` /
 * `--both` pass through), optionally rebuild the desktop installer
 * (`--desktop`), then print old → new version. Every step is a plain npm/git command so a future release pipeline
 * can run the same sequence. Fails fast on the first non-zero exit.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const args = new Set(process.argv.slice(2));
const PULL = args.has("--pull");
const DESKTOP = args.has("--desktop");
// Which CLIs get hooks reinstalled; the installer needs an explicit target
// when not on a TTY. Default is Claude Code; `--codex` / `--both` pass through.
const HOOKS_TARGET = args.has("--both") ? "--both" : args.has("--codex") ? "--codex" : "--claude";

const OK = "✔";
const FAIL = "✖";
const DOT = "·";

function run(cmd, opts = {}) {
  // shell: true so npm's .cmd shim resolves on Windows; every command below is
  // a fixed literal, no user input is interpolated.
  return spawnSync(cmd, {
    cwd: ROOT,
    stdio: opts.quiet ? "pipe" : "inherit",
    shell: true,
    encoding: "utf8",
  });
}

function step(label, cmd, { optional = false } = {}) {
  console.log(`\n${DOT}  ${label}`);
  console.log(`   $ ${cmd}`);
  const res = run(cmd);
  const failed = res.error || res.status !== 0;
  if (failed && !optional) {
    console.error(
      `\n${FAIL}  ${label} failed (exit ${res.status ?? res.error?.message}). Stopping.`
    );
    process.exit(res.status || 1);
  }
  console.log(`${failed ? DOT : OK}  ${label}${failed ? " (skipped)" : ""}`);
}

function installedVersion() {
  // `npm ls -g` lists the linked package under whatever name it was linked as.
  const res = run("npm ls -g --depth=0 --json", { quiet: true });
  try {
    const deps = JSON.parse(res.stdout || "{}").dependencies || {};
    for (const name of [pkg.name, "agent-dashboard"]) {
      if (deps[name]) return { name, version: deps[name].version };
    }
  } catch {
    /* npm ls prints partial JSON when the tree has problems — treat as unknown */
  }
  return null;
}

const before = installedVersion();
console.log(
  `▍${pkg.name} upgrade — ${before ? `${before.name}@${before.version}` : "no global link"} → ${pkg.version}`
);

if (PULL) step("Pull latest commits", "git pull --ff-only");

// Uninstall old: both the current package name and the pre-rebrand one so no
// stale `ccam`/`am` shims from an older link survive.
step("Remove previous global CLI link", `npm uninstall -g ${pkg.name} agent-dashboard`, {
  optional: true,
});

// Desktop app is a separate installed binary; rebuild its installer on request.
// Runs BEFORE setup: on Windows electron-builder prunes the root node_modules
// and the global CLI link, so setup must come after to restore both.
// ponytail: Windows only for now — add darwin (`desktop:dmg`) when someone needs it.
if (DESKTOP) {
  if (process.platform !== "win32") {
    console.log(`${DOT}  --desktop: only Windows is wired up (npm run desktop:win); skipping.`);
  } else {
    step("Build the desktop installer", "npm run desktop:win");
    console.log("   Installer: desktop/release/AgentMonitor-Setup-" + pkg.version + "-x64.exe");
  }
}

step("Install dependencies, build MCP, link `am`", "npm run setup");
step("Build the dashboard client", "npm run build");
step("Reinstall hooks", `npm run install-hooks -- ${HOOKS_TARGET}`);

const after = installedVersion();
console.log(
  `\n${OK}  Upgrade complete: ${before ? `${before.name}@${before.version}` : "none"} → ${after ? `${after.name}@${after.version}` : pkg.version}`
);
console.log(
  `   Restart the dashboard (npm start / pm2 restart) to run the new server, then \`am version\`.`
);
