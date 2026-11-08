/**
 * @file event-grouping.mcpLabel.test.ts
 * @description Locks down `mcpToolLabel`, the compact "Server · action" label
 * used wherever an MCP tool name would otherwise render as its raw
 * "mcp__<server>__<action>" string in a space-constrained chip (e.g. the Top
 * Tools list, #111).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect } from "vitest";
import { mcpToolLabel } from "../event-grouping";

describe("mcpToolLabel", () => {
  it("builds a 'Server · action' label from a namespaced MCP tool name", () => {
    expect(mcpToolLabel("mcp__github__create_pull_request")).toBe("Github · create pull request");
  });

  it("strips a 'claude_ai_' style prefix down to the brand (#111)", () => {
    expect(mcpToolLabel("mcp__claude_ai_Slack__create_issue")).toBe("Slack · create issue");
  });

  it("returns null for a native tool (no mcp__ prefix)", () => {
    expect(mcpToolLabel("Bash")).toBeNull();
  });

  it("returns null for a malformed mcp__ name with no action segment", () => {
    expect(mcpToolLabel("mcp__github")).toBeNull();
  });
});
