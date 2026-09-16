/**
 * @file SystemHealthTab.test.tsx
 * @description Renders the Dashboard Health tab against mocked `settings.info`
 * and `workflows.get` payloads and checks each of the nine panels comes up with
 * its data, so the panel/row/stat/bar atoms keep composing correctly.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SystemHealthTab } from "../SystemHealthTab";

vi.mock("../../../lib/api", () => ({
  api: {
    settings: {
      info: vi.fn(() =>
        Promise.resolve({
          db: {
            path: "/tmp/monitor.db",
            size: 2 * 1024 * 1024,
            counts: { sessions: 10, agents: 20, events: 70 },
            pragmas: {
              journal_mode: "wal",
              synchronous: 1,
              auto_vacuum: 0,
              encoding: "UTF-8",
              foreign_keys: 1,
              busy_timeout: 5000,
            },
            load_stats: { m5: 1, m15: 2, h1: 3 },
          },
          hooks: { installed: true, path: "~/.claude/settings.json", hooks: { PreToolUse: true } },
          server: {
            uptime: 3_700,
            node_version: "v22.0.0",
            platform: "linux",
            ws_connections: 2,
            memory: { rss: 100e6, heapTotal: 50e6, heapUsed: 25e6, external: 1e6 },
            cpu_load: [0.5, 0.4, 0.3],
            arch: "x64",
            total_mem: 16e9,
            free_mem: 8e9,
            cpus: 8,
          },
          transcript_cache: { size: 1, maxSize: 10, hits: 9, misses: 1, keys: [] },
        })
      ),
    },
    workflows: {
      get: vi.fn(() =>
        Promise.resolve({
          stats: { successRate: 95 },
          errorPropagation: { errorRate: 5 },
          modelDelegation: {
            tokensByModel: [
              {
                model: "claude-sonnet-4-5",
                input_tokens: 1000,
                output_tokens: 500,
                cache_read_tokens: 0,
              },
            ],
          },
          concurrency: { aggregateLanes: [{ count: 1 }, { count: 3 }] },
          toolFlow: { toolCounts: [{ tool_name: "Read", count: 1200 }] },
          effectiveness: [
            { subagent_type: "scout", successRate: 80, total: 5, completed: 4, errors: 1 },
          ],
          compaction: { totalCompactions: 2, tokensRecovered: 1500 },
        })
      ),
    },
  },
}));

describe("SystemHealthTab", () => {
  it("renders every panel from the mocked payloads", async () => {
    render(
      <MemoryRouter>
        <SystemHealthTab />
      </MemoryRouter>
    );

    // KeyValueRow + HealthPanel
    expect(await screen.findByText("1h 1m")).toBeInTheDocument();
    expect(screen.getByText("2.0 MB · WAL")).toBeInTheDocument();
    expect(screen.getByText("linux / x64")).toBeInTheDocument();
    // MiniStat (xs in health score, sm in concurrency)
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("1.5K")).toBeInTheDocument();
    expect(screen.getByText("2.0")).toBeInTheDocument();
    // RatioBar (model / tool / subagent)
    expect(screen.getByText("100.0%")).toBeInTheDocument();
    expect(screen.getByText("1.2K")).toBeInTheDocument();
    expect(screen.getByText("scout")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });
});
