/**
 * @file format.test.ts
 * @description Unit tests for the format utility functions to ensure correct formatting of durations, time ago, truncation, and locale-aware date/time in the agent dashboard application.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import i18n from "i18next";
import {
  formatMs,
  formatDuration,
  timeAgo,
  truncate,
  fmt,
  fmtCost,
  formatDateTime,
  formatTime,
  getCurrentLocale,
  formatModelName,
  groupCostByModel,
  promptPreviewLines,
  isTransientProcess,
  formatCostShort,
} from "../format";

describe("formatMs", () => {
  it("should return 0s for negative values", () => {
    expect(formatMs(-1000)).toBe("0s");
    expect(formatMs(-1)).toBe("0s");
  });

  it("should return 0s for zero", () => {
    expect(formatMs(0)).toBe("0s");
  });

  it("should format seconds only", () => {
    expect(formatMs(1000)).toBe("1s");
    expect(formatMs(5000)).toBe("5s");
    expect(formatMs(59000)).toBe("59s");
  });

  it("should format minutes and seconds", () => {
    expect(formatMs(60000)).toBe("1m 0s");
    expect(formatMs(90000)).toBe("1m 30s");
    expect(formatMs(125000)).toBe("2m 5s");
    expect(formatMs(3599000)).toBe("59m 59s");
  });

  it("should format hours and minutes", () => {
    expect(formatMs(3600000)).toBe("1h 0m");
    expect(formatMs(5400000)).toBe("1h 30m");
    expect(formatMs(7260000)).toBe("2h 1m");
  });

  it("should truncate sub-second precision", () => {
    expect(formatMs(1500)).toBe("1s");
    expect(formatMs(999)).toBe("0s");
  });
});

describe("formatDuration", () => {
  it("should compute duration between two ISO strings", () => {
    const start = "2026-03-05T10:00:00.000Z";
    const end = "2026-03-05T10:05:30.000Z";
    expect(formatDuration(start, end)).toBe("5m 30s");
  });

  it("should handle zero duration", () => {
    const t = "2026-03-05T10:00:00.000Z";
    expect(formatDuration(t, t)).toBe("0s");
  });

  it("should handle long durations", () => {
    const start = "2026-03-05T10:00:00.000Z";
    const end = "2026-03-05T12:30:00.000Z";
    expect(formatDuration(start, end)).toBe("2h 30m");
  });
});

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return "just now" for recent times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T10:00:30Z"));
    expect(timeAgo("2026-03-05T10:00:00Z")).toBe("just now");
  });

  it("should return minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T10:05:00Z"));
    expect(timeAgo("2026-03-05T10:00:00Z")).toBe("5m ago");
  });

  it("should return hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T13:00:00Z"));
    expect(timeAgo("2026-03-05T10:00:00Z")).toBe("3h ago");
  });

  it("should return days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T10:00:00Z"));
    expect(timeAgo("2026-03-05T10:00:00Z")).toBe("2d ago");
  });
});

describe("locale-aware date formatting", () => {
  it("should map selected language to the expected locale", async () => {
    await i18n.changeLanguage("zh");
    expect(getCurrentLocale()).toBe("zh-CN");

    await i18n.changeLanguage("vi");
    expect(getCurrentLocale()).toBe("vi-VN");

    await i18n.changeLanguage("ko");
    expect(getCurrentLocale()).toBe("ko-KR");

    await i18n.changeLanguage("es");
    expect(getCurrentLocale()).toBe("es-ES");

    await i18n.changeLanguage("en");
    expect(getCurrentLocale()).toBe("en-US");
  });

  it("should format date-time using the active locale", async () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("formatted-datetime");
    await i18n.changeLanguage("vi");

    expect(formatDateTime("2026-03-05T10:00:00.000Z")).toBe("formatted-datetime");
    expect(spy).toHaveBeenCalledWith(
      "vi-VN",
      expect.objectContaining({
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  });

  it("should format time using the active locale", async () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("formatted-time");
    await i18n.changeLanguage("zh");

    expect(formatTime("2026-03-05T10:00:00.000Z")).toBe("formatted-time");
    expect(spy).toHaveBeenCalledWith(
      "zh-CN",
      expect.objectContaining({
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  });
});

describe("truncate", () => {
  it("should return string unchanged when shorter than max", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("should return string unchanged when exactly max length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("should truncate and add ellipsis when longer than max", () => {
    expect(truncate("hello world", 8)).toBe("hello w\u2026");
  });

  it("should handle max of 1", () => {
    expect(truncate("hello", 1)).toBe("\u2026");
  });

  it("should handle empty string", () => {
    expect(truncate("", 5)).toBe("");
  });
});

describe("fmt", () => {
  it("should return raw number below 1000", () => {
    expect(fmt(0)).toBe("0");
    expect(fmt(999)).toBe("999");
  });

  it("should format thousands with K suffix", () => {
    expect(fmt(1000)).toBe("1.0K");
    expect(fmt(1957)).toBe("2.0K");
    expect(fmt(21986)).toBe("22.0K");
  });

  it("should format millions with M suffix", () => {
    expect(fmt(1_000_000)).toBe("1.0M");
    expect(fmt(1_009_500_000)).toBe("1.0B");
  });

  it("should format billions with B suffix", () => {
    expect(fmt(1_000_000_000)).toBe("1.0B");
    expect(fmt(2_500_000_000)).toBe("2.5B");
  });
});

describe("fmtCost", () => {
  it("should format small costs with dollar sign", () => {
    expect(fmtCost(0)).toBe("$0.00");
    expect(fmtCost(833.97)).toBe("$833.97");
    expect(fmtCost(999.99)).toBe("$999.99");
  });

  it("should format thousands with K suffix", () => {
    expect(fmtCost(1000)).toBe("$1.00K");
    expect(fmtCost(2500.5)).toBe("$2.50K");
  });

  it("should format millions with M suffix", () => {
    expect(fmtCost(1_000_000)).toBe("$1.00M");
  });
});

describe("formatModelName", () => {
  it("returns null for falsy input", () => {
    expect(formatModelName(null)).toBeNull();
    expect(formatModelName(undefined)).toBeNull();
    expect(formatModelName("")).toBeNull();
  });

  it("formats Claude model names with version dots", () => {
    expect(formatModelName("claude-opus-4-7")).toBe("Claude Opus 4.7");
    expect(formatModelName("claude-sonnet-4-5")).toBe("Claude Sonnet 4.5");
    expect(formatModelName("claude-haiku-3-5")).toBe("Claude Haiku 3.5");
  });

  it("strips date suffixes", () => {
    expect(formatModelName("claude-opus-4-7-20260101")).toBe("Claude Opus 4.7");
    expect(formatModelName("claude-sonnet-4-5-20250514")).toBe("Claude Sonnet 4.5");
  });

  it("strips -latest suffix", () => {
    expect(formatModelName("claude-sonnet-4-5-latest")).toBe("Claude Sonnet 4.5");
  });

  it("handles context-window [1m] tag", () => {
    expect(formatModelName("claude-opus-4-7[1m]")).toBe("Claude Opus 4.7 (1M)");
    expect(formatModelName("claude-opus-4-7-20260101[1m]")).toBe("Claude Opus 4.7 (1M)");
  });

  it("formats GPT model names with hyphenated brand-version", () => {
    expect(formatModelName("gpt-4o")).toBe("GPT-4o");
    expect(formatModelName("gpt-4o-mini")).toBe("GPT-4o Mini");
    expect(formatModelName("gpt-4-turbo")).toBe("GPT-4 Turbo");
  });

  it("formats Gemini model names", () => {
    expect(formatModelName("gemini-1-5-pro")).toBe("Gemini 1.5 Pro");
  });

  it("strips provider prefix", () => {
    expect(formatModelName("anthropic/claude-opus-4-7")).toBe("Claude Opus 4.7");
  });

  it("title-cases unknown models", () => {
    expect(formatModelName("o1-mini")).toBe("O1 Mini");
    expect(formatModelName("o1-preview")).toBe("O1 Preview");
  });
});

describe("groupCostByModel", () => {
  it("merges buckets of the same model split by speed/geo/service_tier (#106 reopened)", () => {
    // Shaped after the live breakdown that reopened #106: the same raw model
    // split into a standard bucket, a "workflow"-tier bucket, and (for Opus)
    // a fast-speed bucket - none differing by snapshot date, which is what
    // the prior server-side fix normalized.
    const grouped = groupCostByModel([
      { model: "claude-opus-5", speed: "fast", cost: 10.5 },
      { model: "claude-opus-5", speed: "standard", cost: 979.77 },
      { model: "claude-opus-5", speed: "standard", service_tier: "workflow", cost: 12520 },
      { model: "claude-sonnet-5", cost: 300 },
      { model: "claude-sonnet-5", service_tier: "workflow", cost: 20 },
    ]);
    expect(grouped).toEqual([
      { model: "claude-opus-5", cost: 13510.27 },
      { model: "claude-sonnet-5", cost: 320 },
    ]);
  });

  it("keeps distinct point releases separate (different display names)", () => {
    const grouped = groupCostByModel([
      { model: "claude-opus-5", cost: 10 },
      { model: "claude-opus-5-5", cost: 20 }, // "Claude Opus 5.5" - a different model
    ]);
    expect(grouped.map((r) => r.model)).toEqual(["claude-opus-5-5", "claude-opus-5"]);
  });

  it("drops zero/negative-cost rows and sorts cost descending", () => {
    const grouped = groupCostByModel([
      { model: "claude-haiku-4-5", cost: 0 },
      { model: "claude-sonnet-5", cost: 5 },
      { model: "claude-opus-5", cost: 50 },
    ]);
    expect(grouped).toEqual([
      { model: "claude-opus-5", cost: 50 },
      { model: "claude-sonnet-5", cost: 5 },
    ]);
  });
});

describe("promptPreviewLines", () => {
  it("returns [] for empty input", () => {
    expect(promptPreviewLines(null)).toEqual([]);
    expect(promptPreviewLines(undefined)).toEqual([]);
    expect(promptPreviewLines("  \n \n")).toEqual([]);
  });

  it("trims, drops blank and case-insensitive duplicate lines, keeps the last two", () => {
    expect(promptPreviewLines("  fix bug  \n\nFix Bug\nadd tests\nship it")).toEqual([
      "add tests",
      "ship it",
    ]);
    expect(promptPreviewLines("only one")).toEqual(["only one"]);
  });
});

describe("isTransientProcess", () => {
  it("is true only for pre_identity_process === true", () => {
    expect(isTransientProcess('{"pre_identity_process":true}')).toBe(true);
    expect(isTransientProcess('{"pre_identity_process":"true"}')).toBe(false);
    expect(isTransientProcess('{"pre_identity_process":false}')).toBe(false);
    expect(isTransientProcess("{}")).toBe(false);
  });

  it("is false for empty or malformed metadata", () => {
    expect(isTransientProcess(null)).toBe(false);
    expect(isTransientProcess(undefined)).toBe(false);
    expect(isTransientProcess("")).toBe(false);
    expect(isTransientProcess("{not json")).toBe(false);
  });
});

describe("formatCostShort", () => {
  it("returns $0 for zero, negative and non-finite", () => {
    expect(formatCostShort(0)).toBe("$0");
    expect(formatCostShort(-3)).toBe("$0");
    expect(formatCostShort(NaN)).toBe("$0");
    expect(formatCostShort(Infinity)).toBe("$0");
  });

  it("scales precision with magnitude", () => {
    expect(formatCostShort(12.345)).toBe("$12.35");
    expect(formatCostShort(1)).toBe("$1.00");
    expect(formatCostShort(0.5)).toBe("$0.500");
    expect(formatCostShort(0.01)).toBe("$0.010");
    expect(formatCostShort(0.0012)).toBe("$0.0012");
  });
});
