/**
 * @file permission-input.ts
 * @description Turns a Claude Code permission prompt's raw `tool_input` into an
 * ordered list of typed fields the UI can render properly — a Bash command as a
 * shell block, an Edit as a before/after diff, an AskUserQuestion as its actual
 * questions and options — instead of one `JSON.stringify` blob. Pure and
 * synchronous so it is fully unit-testable.
 *
 * Security property this must preserve: the user is approving *exactly* this
 * tool call, so no key is ever dropped. Tool-specific handling only decides how
 * a key is presented; every key it does not claim is still rendered by the
 * generic pass at the end (`autoFields`).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

/** i18n key suffix under `permissions.field.*`, or null for an unlabelled block. */
export type FieldLabel =
  | "command"
  | "description"
  | "file"
  | "content"
  | "url"
  | "prompt"
  | "pattern"
  | "path"
  | "query"
  | "agent"
  | null;

export type PermissionField =
  /** Monospace block: commands, file contents, anything multi-line. */
  | { kind: "code"; label: FieldLabel; value: string }
  /** Single-line prose. */
  | { kind: "text"; label: FieldLabel; value: string }
  /** A filesystem path — rendered ellipsised from the left, full value in `title`. */
  | { kind: "path"; label: FieldLabel; value: string }
  /** A URL. Rendered as text, never as an anchor: this is untrusted input. */
  | { kind: "url"; label: FieldLabel; value: string }
  /** An Edit's old → new strings. */
  | { kind: "diff"; label: FieldLabel; before: string; after: string }
  /** AskUserQuestion's questions with their options. */
  | {
      kind: "questions";
      label: FieldLabel;
      items: Array<{ question: string; options: Array<{ label: string; description?: string }> }>;
    }
  /** Anything structured we have no better shape for — pretty-printed JSON. */
  | { kind: "json"; label: FieldLabel; value: string; rawKey?: string };

export interface PermissionSummary {
  /** One-line gist for the card header, or null when the fields speak for themselves. */
  headline: string | null;
  fields: PermissionField[];
}

type Input = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Multi-line or long strings read better as a block than as inline prose. */
const isBlocky = (v: string) => v.includes("\n") || v.length > 120;

function jsonField(label: FieldLabel, value: unknown, rawKey?: string): PermissionField {
  return { kind: "json", label, value: JSON.stringify(value, null, 2), rawKey };
}

/** Heuristic field for a key we have no tool-specific handling for. */
function autoField(key: string, value: unknown): PermissionField {
  const s = str(value);
  if (s === null) {
    if (typeof value === "number" || typeof value === "boolean") {
      return { kind: "text", label: null, value: `${key}: ${String(value)}` };
    }
    return jsonField(null, value, key);
  }
  const k = key.toLowerCase();
  if (/url$|uri$|endpoint$/.test(k)) return { kind: "url", label: null, value: s };
  if (/path$|file$|dir$|directory$/.test(k)) return { kind: "path", label: null, value: s };
  if (/command|content|source|script|code|body|diff|patch/.test(k) || isBlocky(s)) {
    return { kind: "code", label: null, value: s };
  }
  return { kind: "text", label: null, value: `${key}: ${s}` };
}

/** Render every key not already claimed by a tool-specific branch. */
function autoFields(input: Input, claimed: string[]): PermissionField[] {
  const skip = new Set(claimed);
  return Object.entries(input)
    .filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => autoField(k, v));
}

/** AskUserQuestion's `questions` array, when it has the expected shape. */
function parseQuestions(value: unknown): PermissionField | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value.flatMap((q) => {
    if (!q || typeof q !== "object") return [];
    const row = q as Record<string, unknown>;
    const question = str(row.question) ?? str(row.header);
    if (!question) return [];
    const options = Array.isArray(row.options)
      ? row.options.flatMap((o) => {
          if (!o || typeof o !== "object") return [];
          const opt = o as Record<string, unknown>;
          const label = str(opt.label);
          if (!label) return [];
          const description = str(opt.description);
          return [description ? { label, description } : { label }];
        })
      : [];
    return [{ question, options }];
  });
  return items.length ? { kind: "questions", label: null, items } : null;
}

/**
 * Build the render plan for one permission prompt. Unknown tools (including
 * every `mcp__*` tool) fall through to the generic pass, which still shows
 * everything — just shaped better than a single blob.
 */
export function summarisePermissionInput(
  toolName: string,
  input: Input | null | undefined
): PermissionSummary {
  const inp: Input = input && typeof input === "object" ? input : {};
  const fields: PermissionField[] = [];
  const claimed: string[] = [];
  let headline: string | null = null;

  const take = (key: string) => {
    claimed.push(key);
    return inp[key];
  };

  switch (toolName) {
    case "Bash":
    case "BashOutput": {
      const command = str(take("command"));
      const description = str(take("description"));
      if (command) {
        fields.push({ kind: "code", label: "command", value: command });
        headline = command.split("\n")[0] ?? command;
      }
      if (description) fields.push({ kind: "text", label: "description", value: description });
      break;
    }

    case "Read":
    case "NotebookRead": {
      const file = str(take("file_path")) ?? str(take("notebook_path"));
      if (file) {
        fields.push({ kind: "path", label: "file", value: file });
        headline = file;
      }
      break;
    }

    case "Write": {
      const file = str(take("file_path"));
      const content = str(take("content"));
      if (file) {
        fields.push({ kind: "path", label: "file", value: file });
        headline = file;
      }
      if (content) fields.push({ kind: "code", label: "content", value: content });
      break;
    }

    case "Edit":
    case "NotebookEdit": {
      const file = str(take("file_path")) ?? str(take("notebook_path"));
      const before = str(take("old_string")) ?? str(take("old_source"));
      const after = str(take("new_string")) ?? str(take("new_source"));
      if (file) {
        fields.push({ kind: "path", label: "file", value: file });
        headline = file;
      }
      if (before !== null || after !== null) {
        fields.push({ kind: "diff", label: null, before: before ?? "", after: after ?? "" });
      }
      break;
    }

    case "Glob":
    case "Grep": {
      const pattern = str(take("pattern"));
      const path = str(take("path"));
      if (pattern) {
        fields.push({ kind: "code", label: "pattern", value: pattern });
        headline = pattern;
      }
      if (path) fields.push({ kind: "path", label: "path", value: path });
      break;
    }

    case "WebFetch": {
      const url = str(take("url"));
      const prompt = str(take("prompt"));
      if (url) {
        fields.push({ kind: "url", label: "url", value: url });
        headline = url;
      }
      if (prompt) fields.push({ kind: "text", label: "prompt", value: prompt });
      break;
    }

    case "WebSearch": {
      const query = str(take("query"));
      if (query) {
        fields.push({ kind: "text", label: "query", value: query });
        headline = query;
      }
      break;
    }

    case "AskUserQuestion": {
      const questions = parseQuestions(take("questions"));
      if (questions && questions.kind === "questions") {
        fields.push(questions);
        headline = questions.items[0]?.question ?? null;
      }
      break;
    }

    case "Task":
    case "Agent": {
      const description = str(take("description"));
      const agent = str(take("subagent_type"));
      const prompt = str(take("prompt"));
      if (description) {
        fields.push({ kind: "text", label: "description", value: description });
        headline = description;
      }
      if (agent) fields.push({ kind: "text", label: "agent", value: agent });
      if (prompt) fields.push({ kind: "code", label: "prompt", value: prompt });
      break;
    }

    default:
      break;
  }

  fields.push(...autoFields(inp, claimed));

  // Nothing at all (an input-less tool): say so rather than render an empty card.
  if (!fields.length) fields.push(jsonField(null, inp));

  return { headline, fields };
}
