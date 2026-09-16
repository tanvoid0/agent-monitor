/**
 * @file permission-input.test.ts
 * @description Covers `summarisePermissionInput`: per-tool shaping, and the
 * invariant that matters most on an approval surface — no key of `tool_input`
 * is ever dropped, whatever the tool.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect } from "vitest";
import { summarisePermissionInput } from "../permission-input";

/** Every string that ends up rendered, flattened — used to assert nothing is lost. */
function rendered(fields: ReturnType<typeof summarisePermissionInput>["fields"]): string {
  return fields
    .map((f) => {
      if (f.kind === "diff") return `${f.before}\n${f.after}`;
      if (f.kind === "questions")
        return f.items
          .map((i) =>
            [i.question, ...i.options.map((o) => `${o.label} ${o.description ?? ""}`)].join("\n")
          )
          .join("\n");
      return f.value;
    })
    .join("\n");
}

describe("summarisePermissionInput", () => {
  it("shapes a Bash command as a code field and headlines the first line", () => {
    const { headline, fields } = summarisePermissionInput("Bash", {
      command: "rm -rf dist\nnpm run build",
      description: "Clean rebuild",
    });
    expect(headline).toBe("rm -rf dist");
    expect(fields[0]).toEqual({
      kind: "code",
      label: "command",
      value: "rm -rf dist\nnpm run build",
    });
    expect(fields[1]).toEqual({ kind: "text", label: "description", value: "Clean rebuild" });
  });

  it("shapes an Edit as a path plus a before/after diff", () => {
    const { fields } = summarisePermissionInput("Edit", {
      file_path: "D:\\p\\server\\index.js",
      old_string: "const PORT = 4820",
      new_string: "const PORT = 4821",
    });
    expect(fields[0]).toMatchObject({ kind: "path", value: "D:\\p\\server\\index.js" });
    expect(fields[1]).toMatchObject({
      kind: "diff",
      before: "const PORT = 4820",
      after: "const PORT = 4821",
    });
  });

  it("parses AskUserQuestion into questions and options", () => {
    const { headline, fields } = summarisePermissionInput("AskUserQuestion", {
      questions: [
        {
          question: "How far should the flow go?",
          header: "Scope",
          options: [
            { label: "Dedicated page", description: "New route" },
            { label: "Session banner" },
          ],
        },
      ],
    });
    expect(headline).toBe("How far should the flow go?");
    expect(fields[0]).toEqual({
      kind: "questions",
      label: null,
      items: [
        {
          question: "How far should the flow go?",
          options: [
            { label: "Dedicated page", description: "New route" },
            { label: "Session banner" },
          ],
        },
      ],
    });
    // `header` is consumed as part of the questions array, not re-rendered.
    expect(fields).toHaveLength(1);
  });

  it("falls back to a JSON field for a malformed questions array", () => {
    const { fields } = summarisePermissionInput("AskUserQuestion", { questions: "nope" });
    expect(fields[0]?.kind).toBe("json");
    expect(rendered(fields)).toContain("nope");
  });

  it("renders every unclaimed key for a known tool", () => {
    const { fields } = summarisePermissionInput("Bash", {
      command: "ls",
      run_in_background: true,
      timeout: 5000,
    });
    const text = rendered(fields);
    expect(text).toContain("ls");
    expect(text).toContain("run_in_background: true");
    expect(text).toContain("timeout: 5000");
  });

  it("renders an unknown MCP tool's whole input", () => {
    const { headline, fields } = summarisePermissionInput("mcp__acme__deploy", {
      target: "prod",
      config: { replicas: 3 },
      notes: "ship it",
    });
    expect(headline).toBeNull();
    const text = rendered(fields);
    expect(text).toContain("prod");
    expect(text).toContain("replicas");
    expect(text).toContain("ship it");
  });

  it("classifies url- and path-suffixed keys by shape", () => {
    const { fields } = summarisePermissionInput("mcp__x__y", {
      endpoint: "https://example.com",
      output_dir: "/tmp/out",
    });
    expect(fields.find((f) => f.kind === "url")).toMatchObject({ value: "https://example.com" });
    expect(fields.find((f) => f.kind === "path")).toMatchObject({ value: "/tmp/out" });
  });

  it("never returns an empty field list", () => {
    expect(summarisePermissionInput("Bash", {}).fields).toHaveLength(1);
    expect(summarisePermissionInput("Bash", null).fields).toHaveLength(1);
  });

  it("treats a WebFetch url as a url field and does not lose the prompt", () => {
    const { fields } = summarisePermissionInput("WebFetch", {
      url: "https://example.com/data.json",
      prompt: "summarise",
    });
    expect(fields[0]).toEqual({
      kind: "url",
      label: "url",
      value: "https://example.com/data.json",
    });
    expect(fields[1]).toEqual({ kind: "text", label: "prompt", value: "summarise" });
  });
});
