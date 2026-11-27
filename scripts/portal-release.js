#!/usr/bin/env node

/**
 * Release steps for Portal's `.portal/pipeline.yml` (Ship / Rehearse).
 *
 * A release here is a version bump pushed to `main`: CI's `release` job then
 * publishes vX.Y.Z with the macOS DMGs, Windows EXEs and Linux AppImage/deb.
 *   node scripts/portal-release.js preflight   on main, clean, in sync, version unreleased
 *   node scripts/portal-release.js verify      npm run verify, with Git Bash on PATH (Windows)
 *   node scripts/portal-release.js push        git push origin main
 *   node scripts/portal-release.js watch       wait for that CI run, list the release assets
 * `--dry-run` (or RELEASE_DRY_RUN=1, which Portal sets on Rehearse) makes push
 * and watch print what they would do instead. Needs `git` and an authenticated `gh`.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { version } = require("../package.json");

const tag = `v${version}`;
const dry = process.argv.includes("--dry-run") || process.env.RELEASE_DRY_RUN === "1";
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe" }).trim();
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const released = () => {
  try {
    sh("gh", ["release", "view", tag]);
    return true;
  } catch {
    return false;
  }
};
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

const steps = {
  preflight() {
    const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== "main") fail(`on ${branch}, not main`);
    if (sh("git", ["status", "--porcelain"])) fail("working tree is dirty — commit first");
    sh("git", ["fetch", "origin", "main"]);
    if (sh("git", ["rev-list", "--count", "HEAD..origin/main"]) !== "0") {
      fail("main is behind origin/main — pull first");
    }
    sh("gh", ["auth", "status"]);
    if (released()) fail(`${tag} is already released — bump the version first`);
    console.log(`✔ ready to release ${tag}`);
  },

  verify() {
    // The gate shells out to `bash` (header audit). Portal runs steps through
    // cmd, where `bash` is WSL's System32 launcher, so put Git Bash first.
    const env = { ...process.env };
    if (process.platform === "win32") {
      const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") || "PATH";
      const gitBin = path.resolve(sh("git", ["--exec-path"]), "../../../bin");
      env[key] = `${gitBin}${path.delimiter}${env[key] || ""}`;
    }
    execFileSync("npm", ["run", "verify"], {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
  },

  push() {
    if (dry) return console.log(`(dry run) would push main to origin, releasing ${tag}`);
    run("git", ["push", "origin", "main"]);
  },

  async watch() {
    const sha = sh("git", ["rev-parse", "HEAD"]);
    if (dry)
      return console.log(`(dry run) would wait for CI on ${sha.slice(0, 7)}, then check ${tag}`);
    let id = "";
    // ponytail: 5 min for GitHub to register the push run; raise if Actions is backed up.
    for (let i = 0; i < 30 && !id; i++) {
      id = sh("gh", [
        "run",
        "list",
        "--workflow",
        "ci.yml",
        "--commit",
        sha,
        // The same commit may have run CI on a release branch first; only
        // main's run has the release job.
        "--branch",
        "main",
        "--event",
        "push",
        "--limit",
        "1",
        "--json",
        "databaseId",
        "--jq",
        ".[0].databaseId // empty",
      ]);
      if (!id) await sleep(10_000);
    }
    if (!id) fail(`no CI run appeared for ${sha.slice(0, 7)}`);
    run("gh", ["run", "watch", id, "--exit-status", "--interval", "30"]);
    if (!released()) fail(`CI passed but ${tag} was not published`);
    console.log(
      sh("gh", ["release", "view", tag, "--json", "url,assets", "--jq", ".url, .assets[].name"])
    );
  },
};

const step = steps[process.argv[2]];
if (!step)
  fail(`usage: node scripts/portal-release.js <${Object.keys(steps).join("|")}> [--dry-run]`);
Promise.resolve()
  .then(step)
  .catch((err) => fail(err.stderr?.toString().trim() || err.message));
