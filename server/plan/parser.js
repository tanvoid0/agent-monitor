/**
 * @file PROGRESS.md grammar (docs/plan-layer.md §4.3): Status line, milestones
 * with numbered steps, the current step and any sandboxes with their lanes and
 * nested checkbox tasks. Also the retired `.local/log.md` line grammar and the
 * `tick` text transform. A port of the v2 board's parse_plan/parse_log; pure
 * functions, no I/O.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

const MODES = ["serial", "parallel", "inline", "optional"];

function splitHead(sec) {
  const nl = sec.indexOf("\n");
  return nl === -1 ? [sec, ""] : [sec.slice(0, nl), sec.slice(nl + 1)];
}

// Everything under a `### ` heading up to the next one.
const SUB_SECTION = /^### ([^\n]*)$((?:\n(?!###)[^\n]*)*)/gm;

function parseMilestones(body) {
  const milestones = [];
  let current = null;
  for (const m of body.matchAll(SUB_SECTION)) {
    const head = /^(M\d+) — (.+?)\s*(✅|🔶)?\s*$/.exec(m[1]);
    if (!head) continue;
    const steps = [];
    for (const s of m[2].matchAll(/^- \[([ x])\] (\d\d) (.+)$/gm)) {
      let title = s[3];
      const isCurrent = title.includes("**current**");
      const commit = /`([0-9a-f]{7,40})`/.exec(title);
      title = title.replace(/\s*\(`[0-9a-f]{7,40}`\)|\s*—\s*\*\*current\*\*/g, "").trim();
      if (isCurrent) current = parseInt(s[2], 10);
      steps.push({
        num: s[2],
        title,
        done: s[1] === "x",
        current: isCurrent,
        commit: commit ? commit[1] : null,
      });
    }
    milestones.push({
      id: head[1],
      title: head[2].trim(),
      done: steps.length > 0 && steps.every((x) => x.done),
      steps,
    });
  }
  return { milestones, current };
}

function parseLanes(body) {
  const lanes = [];
  for (const lm of body.matchAll(SUB_SECTION)) {
    const head = /^Lane ([A-Z]) — (.+)$/.exec(lm[1]);
    if (!head) continue;
    const parts = head[2].split("·").map((p) => p.trim());
    const tags = parts.slice(1);
    const touches = /^_touches: (.+)_$/m.exec(lm[2]);
    const tasks = [];
    const stack = [];
    for (const t of lm[2].matchAll(/^( *)- \[([ x])\] (\S+) (.+)$/gm)) {
      const depth = Math.floor(t[1].length / 2);
      const node = { key: t[3], text: t[4].trim(), depth, ticked: t[2] === "x", children: [] };
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      (stack.length ? stack[stack.length - 1].children : tasks).push(node);
      stack.push(node);
    }
    lanes.push({
      letter: head[1],
      name: parts[0],
      tags,
      mode: tags.find((t) => MODES.includes(t)) || null,
      touches: touches ? touches[1].trim() : "",
      tasks,
    });
  }
  return lanes;
}

function parseStory(head, body, sandboxCount) {
  const isStep = head.startsWith("## Current step:");
  let num = null;
  let title;
  let id;
  if (isStep) {
    const hm = /^## Current step: (\d+)\s*—\s*(.+)$/.exec(head);
    num = hm ? parseInt(hm[1], 10) : null;
    title = hm ? hm[2].trim() : head.slice("## Current step:".length).trim();
    id = `step-${num}`;
  } else {
    title = head.slice("## Sandbox:".length).trim();
    id = `sandbox-${sandboxCount + 1}`;
  }
  // to the first blank line or the end of the section (no `m` flag: `$` is
  // end of input, as Python's \Z)
  const dw = /(?:^|\n)Done when:\s*([\s\S]*?)(?=\n\s*\n|$)/.exec(body);
  const doneWhen = dw ? dw[1].replace(/\s+/g, " ").trim() : "";
  const firstLane = body.indexOf("### Lane");
  let pre = body.slice(0, firstLane >= 0 ? firstLane : body.length);
  if (dw) pre = pre.replace(dw[0], "");
  return {
    id,
    kind: isStep ? "step" : "sandbox",
    num,
    title,
    doneWhen,
    decisions: pre.trim(),
    lanes: parseLanes(body),
  };
}

/** PROGRESS.md → { status, steps, milestones, stories }. */
function parsePlan(md) {
  const status = /^\*\*Status \(([^)]+)\):\*\*\s*(.+)$/m.exec(md);
  const plan = {
    status: status ? { date: status[1], text: status[2].trim() } : { date: "", text: "" },
    milestones: [],
    stories: [],
  };
  let current = null;
  for (const sec of md.split(/^(?=## )/m)) {
    const [head, body] = splitHead(sec);
    if (head.startsWith("## Milestones")) {
      const parsed = parseMilestones(body);
      plan.milestones = parsed.milestones;
      current = parsed.current;
    } else if (head.startsWith("## Current step:") || head.startsWith("## Sandbox:")) {
      const sandboxes = plan.stories.filter((s) => s.kind === "sandbox").length;
      plan.stories.push(parseStory(head, body, sandboxes));
    }
  }
  const steps = plan.milestones.flatMap((m) => m.steps);
  plan.steps = { done: steps.filter((s) => s.done).length, total: steps.length, current };
  // steps before sandboxes, otherwise file order
  plan.stories.sort((a, b) => (a.kind === "step" ? 0 : 1) - (b.kind === "step" ? 0 : 1));
  return plan;
}

const LOG_LINE = /^- (\S+) · ([^·]+?) · ([^·]+?) · (start|done|blocked|note) · ?(.*)$/;

/** `.local/log.md` → [{ section, ts, agent, key, status, note }] in file order. */
function parseLog(md) {
  const out = [];
  let section = null;
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      section = line.slice(3).trim().toLowerCase();
      continue;
    }
    const m = LOG_LINE.exec(line);
    if (m && section !== null) {
      out.push({
        section,
        ts: m[1],
        agent: m[2].trim(),
        key: m[3].trim(),
        status: m[4],
        note: m[5].trim(),
      });
    }
  }
  return out;
}

/** Depth-first over a task tree, parents before children. */
function* walk(tasks) {
  for (const t of tasks) {
    yield t;
    yield* walk(t.children);
  }
}

/**
 * Flip `- [ ] KEY` ↔ `- [x] KEY` (first match, any indent) and rewrite the
 * `(N / M boxes)` figure in the Status line from the current step's ticks.
 * Returns the new markdown, or null when the key is not in the file.
 */
function tick(md, key, done) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pat = new RegExp(`^(\\s*- \\[)([ x])(\\] ${esc} )`, "m");
  if (!pat.test(md)) return null;
  let out = md.replace(pat, (_m, a, _b, c) => `${a}${done ? "x" : " "}${c}`);
  const step = parsePlan(out).stories.find((s) => s.kind === "step");
  if (step) {
    const boxes = step.lanes.flatMap((l) => [...walk(l.tasks)]);
    const n = boxes.filter((t) => t.ticked).length;
    out = out.replace(/\(\d+ \/ \d+ boxes\)/, `(${n} / ${boxes.length} boxes)`);
  }
  return out;
}

module.exports = { parsePlan, parseLog, walk, tick };
