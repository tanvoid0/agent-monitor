/**
 * @file SystemHealthTab.tsx
 * @description Dashboard Health tab: runtime, storage, health score, model
 * token share, concurrency, tool usage, subagent effectiveness, hook gateway
 * and platform config panels, polled from `/api/settings/info` and
 * `/api/workflows` every 30s. Copy lives in `dashboard.json` under `health.*`;
 * repeated panel/row/stat/bar shapes come from `./atoms`.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Zap,
  Activity,
  GitBranch,
  Server,
  HardDrive,
  Plug,
  Cpu,
  BarChart3,
  ShieldCheck,
  Database,
  Search,
} from "lucide-react";
import { api } from "../../lib/api";
import { useDataScope } from "../../lib/dataScope";
import { Tip } from "../Tip";
import { EntityRef } from "../entity";
import { formatModelName } from "../../lib/format";
import type { WorkflowData } from "../../lib/types";
import { HealthPanel, KeyValueRow, MiniStat, RatioBar } from "./atoms";
import { Badge } from "../ui/Badge";

interface SystemInfo {
  db: {
    path: string;
    size: number;
    counts: Record<string, number>;
    pragmas: {
      journal_mode: string;
      synchronous: number;
      auto_vacuum: number;
      encoding: string;
      foreign_keys: number;
      busy_timeout: number;
    };
    load_stats: { m5: number; m15: number; h1: number };
  };
  hooks: { installed: boolean; path: string; hooks: Record<string, boolean> };
  server: {
    uptime: number;
    node_version: string;
    platform: string;
    ws_connections: number;
    memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
    cpu_load: number[];
    arch: string;
    total_mem: number;
    free_mem: number;
    cpus: number;
  };
  transcript_cache: {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    keys: string[];
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function SystemHealthTab() {
  const { t } = useTranslation("dashboard");
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [scope] = useDataScope();

  const loadData = useCallback(async () => {
    try {
      const [infoRes, workflowRes] = await Promise.all([api.settings.info(), api.workflows.get()]);
      setInfo(infoRes as any);
      setWorkflow(workflowRes);
    } catch (e) {
      console.error(e);
    }
  }, [scope]);

  useEffect(() => {
    loadData();
    const int = setInterval(loadData, 30000); // 30s is sufficient for health metrics
    return () => clearInterval(int);
  }, [loadData]);

  const stats = useMemo(() => {
    if (!info || !workflow) return null;

    const totalEntries =
      (info.db.counts?.sessions || 0) +
      (info.db.counts?.agents || 0) +
      (info.db.counts?.events || 0);
    const sessPct = totalEntries > 0 ? ((info.db.counts?.sessions || 0) / totalEntries) * 100 : 0;
    const agentPct = totalEntries > 0 ? ((info.db.counts?.agents || 0) / totalEntries) * 100 : 0;
    const eventPct = totalEntries > 0 ? ((info.db.counts?.events || 0) / totalEntries) * 100 : 0;

    const modelStats = (workflow.modelDelegation?.tokensByModel || [])
      .sort((a, b) => b.input_tokens + b.output_tokens - (a.input_tokens + a.output_tokens))
      .slice(0, 6);
    const totalTokens = modelStats.reduce((sum, m) => sum + m.input_tokens + m.output_tokens, 0);

    const memUsedPct =
      info.server.total_mem > 0 ? (1 - info.server.free_mem / info.server.total_mem) * 100 : 0;
    const heapUsedPct =
      info.server.memory.heapTotal > 0
        ? (info.server.memory.heapUsed / info.server.memory.heapTotal) * 100
        : 0;

    return {
      totalEntries,
      sessPct,
      agentPct,
      eventPct,
      modelStats,
      totalTokens,
      memUsedPct,
      heapUsedPct,
    };
  }, [info, workflow]);

  if (!info || !workflow || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="animate-pulse h-48 bg-surface-2 rounded-2xl" />
        ))}
      </div>
    );
  }

  const {
    totalEntries,
    sessPct,
    agentPct,
    eventPct,
    modelStats,
    totalTokens,
    memUsedPct,
    heapUsedPct,
  } = stats;
  const successRate = Math.max(0, Math.min(100, workflow.stats.successRate));
  const errorRate = Math.max(
    0,
    Math.min(100, workflow.errorPropagation?.errorRate ?? 100 - successRate)
  );
  const cacheHitRate = Math.max(
    0,
    Math.min(
      100,
      ((info.transcript_cache?.hits ?? 0) /
        ((info.transcript_cache?.hits ?? 0) + (info.transcript_cache?.misses ?? 0) || 1)) *
        100
    )
  );

  // Concurrency histogram data
  const lanes = workflow.concurrency?.aggregateLanes || [];
  const maxLaneCount = Math.max(...lanes.map((l) => l.count), 1);

  // Tool flow top tools
  const topTools = (workflow.toolFlow?.toolCounts || []).slice(0, 8);
  const maxToolCount = topTools.length > 0 ? (topTools[0]?.count ?? 1) : 1;

  // Subagent effectiveness
  const effectiveness = (workflow.effectiveness || []).slice(0, 6);

  // Composite health score - clamped to [0, 100] for display safety
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      successRate * 0.4 +
        cacheHitRate * 0.25 +
        Math.max(0, 100 - errorRate) * 0.25 +
        Math.max(0, 100 - Math.min(100, heapUsedPct)) * 0.1
    )
  );

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Row 1: Runtime + Storage + Health Score */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Runtime Environment */}
        <HealthPanel
          icon={Server}
          title={t("health.runtime")}
          actions={
            <span className="text-[10px] font-mono text-gray-500">
              {t("health.coresArch", { count: info.server.cpus, arch: info.server.arch })}
            </span>
          }
        >
          <div className="space-y-2.5">
            <KeyValueRow label={t("health.uptime")}>
              <span className="text-xs text-gray-200 font-mono ml-auto">
                {formatUptime(info.server.uptime)}
              </span>
            </KeyValueRow>
            <KeyValueRow label={t("health.cpuLoad")}>
              <div className="flex gap-1 ml-auto">
                {(info.server.cpu_load || []).slice(0, 3).map((load, i) => (
                  <span
                    key={i}
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${i === 0 && load > info.server.cpus ? "bg-red-500/20 text-red-400" : "bg-surface-3 text-gray-300"}`}
                  >
                    {load.toFixed(2)}
                  </span>
                ))}
              </div>
            </KeyValueRow>
            <KeyValueRow label={t("health.nodeRss")}>
              <span className="text-xs text-gray-200 font-mono ml-auto">
                {formatBytes(info.server.memory.rss)}
              </span>
            </KeyValueRow>
          </div>

          <div className="border-t border-border/40 pt-3 space-y-3">
            <Tip
              block
              raw={t("health.hostMemoryTip", {
                pct: memUsedPct.toFixed(1),
                used: formatBytes(info.server.total_mem - info.server.free_mem),
                total: formatBytes(info.server.total_mem),
              })}
            >
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">{t("health.hostMemory")}</span>
                  <span className="text-gray-400 font-mono">{memUsedPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-surface-3 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${memUsedPct > 90 ? "bg-red-500" : memUsedPct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${memUsedPct}%` }}
                  />
                </div>
              </div>
            </Tip>
            <Tip
              block
              raw={t("health.v8HeapTip", {
                pct: heapUsedPct.toFixed(1),
                used: formatBytes(info.server.memory.heapUsed),
                total: formatBytes(info.server.memory.heapTotal),
                external: formatBytes(info.server.memory.external),
              })}
            >
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">{t("health.v8Heap")}</span>
                  <span className="text-gray-400 font-mono">{heapUsedPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-surface-3 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${heapUsedPct > 85 ? "bg-red-500" : heapUsedPct > 60 ? "bg-amber-500" : "bg-blue-500"}`}
                    style={{ width: `${heapUsedPct}%` }}
                  />
                </div>
              </div>
            </Tip>
          </div>
        </HealthPanel>

        {/* Storage Engine */}
        <HealthPanel
          icon={Database}
          title={t("health.storage")}
          actions={
            <Tip
              raw={t("health.writeVelocityTip", {
                m5: info.db.load_stats?.m5 ?? 0,
                m15: info.db.load_stats?.m15 ?? 0,
                h1: info.db.load_stats?.h1 ?? 0,
              })}
            >
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/5 px-2 py-0.5 rounded border border-emerald-500/10 cursor-default">
                ⚡ {info.db.load_stats?.m5 ?? 0}/{info.db.load_stats?.m15 ?? 0}/
                {info.db.load_stats?.h1 ?? 0}
              </span>
            </Tip>
          }
        >
          <KeyValueRow label={t("health.database")}>
            <span className="text-xs text-gray-200 font-mono ml-auto">
              {formatBytes(info.db.size)} · {info.db.pragmas?.journal_mode?.toUpperCase() || "WAL"}
            </span>
          </KeyValueRow>

          {/* Pie chart + legend using same pattern as Analytics DonutChart */}
          <div className="flex items-center justify-center gap-5 flex-1">
            <Tip
              raw={t("health.recordDistributionTip", {
                sessions: (info.db.counts?.sessions ?? 0).toLocaleString(),
                sessPct: sessPct.toFixed(1),
                agents: (info.db.counts?.agents ?? 0).toLocaleString(),
                agentPct: agentPct.toFixed(1),
                events: (info.db.counts?.events ?? 0).toLocaleString(),
                eventPct: eventPct.toFixed(1),
                total: totalEntries.toLocaleString(),
              })}
            >
              <svg
                width={96}
                height={96}
                viewBox="0 0 96 96"
                className="flex-shrink-0 cursor-default"
              >
                <circle cx="48" cy="48" r="38" fill="none" stroke="#1e1e2e" strokeWidth="14" />
                {(() => {
                  const r = 38,
                    cx = 48,
                    cy = 48,
                    circumference = 2 * Math.PI * r;
                  const segments = [
                    { pct: sessPct, color: "#60a5fa" },
                    { pct: agentPct, color: "#8b5cf6" },
                    { pct: eventPct, color: "#34d399" },
                  ];
                  let offset = circumference / 4;
                  return segments.map((seg, i) => {
                    if (seg.pct <= 0) return null;
                    const dash = (seg.pct / 100) * circumference;
                    const gap = circumference - dash;
                    const currentOffset = offset;
                    offset -= dash;
                    return (
                      <circle
                        key={i}
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="14"
                        strokeDasharray={`${dash} ${gap}`}
                        strokeDashoffset={currentOffset}
                      />
                    );
                  });
                })()}
                <text
                  x="48"
                  y="46"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-300"
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  {totalEntries > 999 ? `${(totalEntries / 1000).toFixed(1)}K` : totalEntries}
                </text>
                <text
                  x="48"
                  y="60"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-600"
                  fontSize="8"
                >
                  {t("health.total")}
                </text>
              </svg>
            </Tip>
            <div className="space-y-2.5">
              {[
                {
                  label: t("health.sessions"),
                  value: info.db.counts?.sessions ?? 0,
                  color: "#60a5fa",
                  pct: sessPct,
                },
                {
                  label: t("health.agents"),
                  value: info.db.counts?.agents ?? 0,
                  color: "#8b5cf6",
                  pct: agentPct,
                },
                {
                  label: t("health.events"),
                  value: info.db.counts?.events ?? 0,
                  color: "#34d399",
                  pct: eventPct,
                },
              ].map((item) => (
                <Tip
                  block
                  key={item.label}
                  raw={t("health.recordShareTip", {
                    label: item.label,
                    value: item.value.toLocaleString(),
                    pct: item.pct.toFixed(1),
                  })}
                >
                  <div className="flex items-center gap-2 text-xs cursor-default">
                    <span
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-gray-400">{item.label}</span>
                    <span className="text-gray-500 ml-auto pl-3 font-mono">
                      {Math.round(item.pct)}%
                    </span>
                  </div>
                </Tip>
              ))}
            </div>
          </div>
        </HealthPanel>

        {/* Health Score */}
        <HealthPanel
          icon={ShieldCheck}
          title={t("health.healthScore")}
          actions={
            <Tip
              raw={t("health.formulaTip", {
                success: successRate.toFixed(1),
                cache: cacheHitRate.toFixed(1),
                errorAvoid: (100 - errorRate).toFixed(1),
                heap: (100 - heapUsedPct).toFixed(1),
                score: healthScore.toFixed(1),
              })}
            >
              <span className="text-[10px] text-gray-500 cursor-help border-b border-dashed border-gray-700">
                {t("health.formula")}
              </span>
            </Tip>
          }
        >
          {/* Ring gauge - centered */}
          <div className="flex items-center justify-center flex-1">
            <Tip
              raw={t("health.scoreTip", {
                score: healthScore.toFixed(1),
                success: successRate.toFixed(1),
                cache: cacheHitRate.toFixed(1),
                errorAvoid: (100 - errorRate).toFixed(1),
                heap: (100 - heapUsedPct).toFixed(1),
              })}
            >
              <svg width="120" height="120" viewBox="0 0 120 120" className="cursor-default">
                <circle cx="60" cy="60" r="48" fill="none" stroke="#1e1e2e" strokeWidth="10" />
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  stroke={healthScore >= 90 ? "#34d399" : healthScore >= 70 ? "#fbbf24" : "#f87171"}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${healthScore * 3.016} ${301.6 - healthScore * 3.016}`}
                  strokeDashoffset={301.6 / 4}
                  className="transition-all duration-1000"
                />
                <text
                  x="60"
                  y="57"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-100"
                  fontSize="24"
                  fontWeight="800"
                  fontFamily="monospace"
                >
                  {healthScore.toFixed(0)}
                </text>
                <text
                  x="60"
                  y="76"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-gray-600"
                  fontSize="9"
                  fontWeight="500"
                >
                  / 100
                </text>
              </svg>
            </Tip>
          </div>

          {/* Sub-metrics row */}
          <div className="grid grid-cols-4 gap-2 border-t border-border/40 pt-3">
            <MiniStat
              label={t("health.cache")}
              value={`${cacheHitRate.toFixed(0)}%`}
              tone="text-blue-400"
              tip={t("health.cacheTip", {
                pct: cacheHitRate.toFixed(1),
                hits: info.transcript_cache?.hits ?? 0,
                misses: info.transcript_cache?.misses ?? 0,
              })}
            />
            <MiniStat
              label={t("health.errors")}
              value={`${errorRate.toFixed(1)}%`}
              tone={
                errorRate < 5
                  ? "text-emerald-400"
                  : errorRate < 15
                    ? "text-amber-400"
                    : "text-red-400"
              }
              tip={t("health.errorsTip", { pct: errorRate.toFixed(2) })}
            />
            <MiniStat
              label={t("health.compact")}
              value={workflow.compaction?.totalCompactions ?? 0}
              tone="text-violet-400"
              tip={t("health.compactTip", { count: workflow.compaction?.totalCompactions ?? 0 })}
            />
            <MiniStat
              label={t("health.saved")}
              value={`${((workflow.compaction?.tokensRecovered ?? 0) / 1000).toFixed(1)}K`}
              tone="text-emerald-400"
              tip={t("health.savedTip", { count: workflow.compaction?.tokensRecovered ?? 0 })}
            />
          </div>
        </HealthPanel>
      </div>

      {/* Row 2: Model Usage + Concurrency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model Token Distribution */}
        <HealthPanel
          icon={Bot}
          title={t("health.tokenUsage")}
          actions={
            <span className="text-[10px] font-mono text-gray-500">
              {t("health.tokensTotal", { total: (totalTokens / 1000).toFixed(1) })}
            </span>
          }
        >
          <div className="space-y-2.5">
            {modelStats.map((m, i) => {
              const pct =
                totalTokens > 0 ? ((m.input_tokens + m.output_tokens) / totalTokens) * 100 : 0;
              const colors = [
                "bg-blue-400",
                "bg-violet-400",
                "bg-emerald-400",
                "bg-amber-400",
                "bg-pink-400",
                "bg-cyan-400",
              ];
              return (
                <RatioBar
                  key={i}
                  tip={t("health.modelTip", {
                    model: formatModelName(m.model) ?? m.model,
                    input: m.input_tokens,
                    output: m.output_tokens,
                    cacheRead: m.cache_read_tokens,
                    pct: pct.toFixed(1),
                  })}
                  label={
                    <EntityRef
                      kind="model"
                      model={m.model}
                      mono={false}
                      className="text-xs text-gray-400 w-28 flex-shrink-0"
                    >
                      {formatModelName(m.model) ?? m.model}
                    </EntityRef>
                  }
                  pct={pct}
                  color={colors[i % colors.length]}
                  duration="duration-700"
                  value={
                    <span className="text-xs text-gray-500 w-12 text-right flex-shrink-0 font-mono">
                      {pct.toFixed(1)}%
                    </span>
                  }
                />
              );
            })}
            {modelStats.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">{t("health.noModelData")}</p>
            )}
          </div>
        </HealthPanel>

        {/* Concurrency Timeline */}
        <HealthPanel
          icon={BarChart3}
          title={t("health.concurrency")}
          actions={
            <span className="text-[10px] font-mono text-gray-500">
              {t("health.intervals", { count: lanes.length })}
            </span>
          }
        >
          {/* Sparkline-style bar chart matching Analytics sparkline */}
          <Tip
            block
            raw={t("health.concurrencyTip", {
              peak: maxLaneCount,
              active: lanes.filter((l) => l.count > 0).length,
              avg:
                lanes.length > 0
                  ? (lanes.reduce((s, l) => s + l.count, 0) / lanes.length).toFixed(1)
                  : "0",
            })}
          >
            <div className="flex items-end gap-px h-20 cursor-default">
              {lanes.slice(-Math.min(lanes.length, 40)).map((lane, i) => {
                const barPct =
                  maxLaneCount > 0 ? Math.max(4, Math.round((lane.count / maxLaneCount) * 100)) : 4;
                const color =
                  lane.count > 5
                    ? "#f87171"
                    : lane.count > 2
                      ? "#fbbf24"
                      : lane.count > 0
                        ? "#34d399"
                        : "#1e1e2e";
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-sm transition-all"
                    style={{
                      height: `${barPct}%`,
                      backgroundColor: color,
                      opacity: lane.count === 0 ? 0.2 : 0.85,
                    }}
                  />
                );
              })}
              {lanes.length === 0 && (
                <p className="text-xs text-gray-600 text-center w-full self-center">
                  {t("health.noConcurrencyData")}
                </p>
              )}
            </div>
          </Tip>

          <div className="grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
            <MiniStat
              label={t("health.peak")}
              value={maxLaneCount}
              tone="text-gray-200"
              size="sm"
              tip={t("health.peakTip", { peak: maxLaneCount })}
            />
            <MiniStat
              label={t("health.active")}
              value={lanes.filter((l) => l.count > 0).length}
              tone="text-emerald-400"
              size="sm"
              tip={t("health.activeTip", {
                active: lanes.filter((l) => l.count > 0).length,
                total: lanes.length,
              })}
            />
            <MiniStat
              label={t("health.avg")}
              value={
                lanes.length > 0
                  ? (lanes.reduce((s, l) => s + l.count, 0) / lanes.length).toFixed(1)
                  : "0"
              }
              tone="text-blue-400"
              size="sm"
              tip={t("health.avgTip")}
            />
          </div>
        </HealthPanel>
      </div>

      {/* Row 3: Tool Usage + Subagent Effectiveness */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tool Invocations */}
        <HealthPanel
          icon={Zap}
          title={t("health.toolUsage")}
          actions={
            <span className="text-[10px] font-mono text-gray-500">
              {t("health.topTools", { n: topTools.length })}
            </span>
          }
        >
          <div className="space-y-2">
            {topTools.map((tool, i) => {
              const pct = maxToolCount > 0 ? Math.round((tool.count / maxToolCount) * 100) : 0;
              const colors = [
                "bg-amber-400",
                "bg-blue-400",
                "bg-emerald-400",
                "bg-violet-400",
                "bg-pink-400",
                "bg-cyan-400",
                "bg-red-400",
                "bg-indigo-400",
              ];
              return (
                <RatioBar
                  key={i}
                  tip={t("health.toolTip", { tool: tool.tool_name, count: tool.count })}
                  label={
                    <EntityRef
                      kind="tool"
                      name={tool.tool_name}
                      mono={false}
                      className="text-xs text-gray-400 w-28 flex-shrink-0"
                    />
                  }
                  pct={pct}
                  color={colors[i % colors.length]}
                  value={
                    <span className="text-xs text-gray-500 w-10 text-right flex-shrink-0 font-mono">
                      {tool.count > 999 ? `${(tool.count / 1000).toFixed(1)}K` : tool.count}
                    </span>
                  }
                />
              );
            })}
            {topTools.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-6">{t("health.noToolData")}</p>
            )}
          </div>
        </HealthPanel>

        {/* Subagent Effectiveness */}
        <HealthPanel icon={GitBranch} title={t("health.subagentEffectiveness")}>
          <div className="space-y-2">
            {effectiveness.map((item, i) => {
              const color =
                item.successRate >= 90
                  ? "bg-emerald-400"
                  : item.successRate >= 70
                    ? "bg-amber-400"
                    : "bg-red-400";
              return (
                <RatioBar
                  key={i}
                  tip={t("health.effectivenessTip", {
                    type: item.subagent_type || t("health.defaultSubagent"),
                    pct: item.successRate.toFixed(1),
                    total: item.total,
                    completed: item.completed,
                    errors: item.errors,
                  })}
                  label={
                    <span className="text-xs text-gray-400 w-28 truncate flex-shrink-0">
                      {item.subagent_type || t("health.defaultSubagent")}
                    </span>
                  }
                  pct={item.successRate}
                  color={color}
                  value={
                    <span
                      className={`text-xs w-12 text-right flex-shrink-0 font-mono ${item.successRate >= 90 ? "text-emerald-400" : item.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}
                    >
                      {item.successRate.toFixed(0)}%
                    </span>
                  }
                />
              );
            })}
            {effectiveness.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-6">{t("health.noSubagentData")}</p>
            )}
          </div>
        </HealthPanel>
      </div>

      {/* Row 4: Integration Gateway + Platform Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Integration Gateway */}
        <HealthPanel
          icon={Plug}
          title={t("health.integration")}
          actions={
            <Badge
              tone={info.hooks.installed ? "success" : "neutral"}
              size="xs"
              dot
              pulse={info.hooks.installed}
              mono
            >
              {info.hooks.installed ? t("health.hooksActive") : t("health.hooksOffline")}
            </Badge>
          }
        >
          {Object.entries(info.hooks.hooks || {}).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(info.hooks.hooks).map(([hook, active]) => (
                <Tip
                  block
                  key={hook}
                  raw={t("health.hookTip", {
                    hook,
                    status: active ? t("health.connected") : t("health.disconnected"),
                  })}
                >
                  <div className="flex items-center gap-3 bg-surface-2/50 px-3 py-2 rounded-lg border border-border/30 cursor-default">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? "bg-emerald-400" : "bg-gray-600"}`}
                    />
                    {/* Keys are hook event names (PreToolUse, Stop, …), so the
                        chip filters the Activity feed by that event type. */}
                    <EntityRef kind="eventType" type={hook} className="text-xs" />
                  </div>
                </Tip>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 border border-dashed border-border/40 rounded-lg">
              <Search className="w-4 h-4 text-gray-600 mb-2" />
              <p className="text-xs text-gray-500">{t("health.noHooks")}</p>
            </div>
          )}

          <Tip block raw={t("health.wsTip", { count: info.server.ws_connections })}>
            <div className="flex items-center gap-3 bg-emerald-500/5 px-3 py-2.5 rounded-lg border border-emerald-500/10 cursor-default">
              <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <div>
                <p className="text-[10px] text-emerald-400 font-medium">{t("health.wsActive")}</p>
                <p className="text-[10px] text-gray-500">
                  {t("health.wsConnections", { count: info.server.ws_connections })}
                </p>
              </div>
            </div>
          </Tip>
        </HealthPanel>

        {/* Platform Config */}
        <HealthPanel
          icon={Cpu}
          title={t("health.platform")}
          actions={
            <span className="text-[10px] font-mono text-gray-500">{info.server.node_version}</span>
          }
        >
          <div className="space-y-2">
            {[
              {
                label: t("health.journalMode"),
                value: info.db.pragmas?.journal_mode?.toUpperCase() || "WAL",
              },
              {
                label: t("health.synchronous"),
                value:
                  info.db.pragmas?.synchronous === 2
                    ? "FULL"
                    : info.db.pragmas?.synchronous === 1
                      ? "NORMAL"
                      : "OFF",
              },
              {
                label: t("health.autoVacuum"),
                value: info.db.pragmas?.auto_vacuum > 0 ? "FULL" : "OFF",
              },
              {
                label: t("health.foreignKeys"),
                value: info.db.pragmas?.foreign_keys ? "ON" : "OFF",
              },
              {
                label: t("health.busyTimeout"),
                value: `${info.db.pragmas?.busy_timeout || 5000}ms`,
              },
              {
                label: t("health.platform"),
                value: `${info.server.platform} / ${info.server.arch}`,
              },
            ].map((row) => (
              <KeyValueRow key={row.label} label={row.label}>
                <span className="text-xs text-gray-200 font-mono ml-auto">{row.value}</span>
              </KeyValueRow>
            ))}
          </div>

          <Tip block raw={info.db.path}>
            <div className="flex items-center gap-2 bg-surface-2/50 px-3 py-2 rounded-lg border border-border/30 cursor-default">
              <HardDrive className="w-3 h-3 text-gray-500 flex-shrink-0" />
              <span className="text-[10px] text-gray-400 font-mono truncate">{info.db.path}</span>
            </div>
          </Tip>
        </HealthPanel>
      </div>
    </div>
  );
}
