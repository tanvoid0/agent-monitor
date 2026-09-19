/**
 * @file Tests for the Kanban project panel: row building (active / waiting /
 * unseen-completed counts, recent-activity stamp), basename disambiguation,
 * sort modes, URL param parsing, and the multi-select interaction.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ProjectPanel,
  buildProjectRows,
  disambiguate,
  parseProjectParam,
  sortRows,
  type ProjectRow,
} from "../ProjectPanel";
import type { Session } from "../../../lib/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count ? `${k}:${o.count}` : k),
  }),
}));

const session = (over: Partial<Session>): Session =>
  ({
    id: "s",
    status: "active",
    cwd: "D:/a/x",
    started_at: "2026-09-15T10:00:00Z",
    ended_at: null,
    ...over,
  }) as Session;

const rootByCwd = new Map([
  ["D:/a/x", "D:/a/x"],
  ["D:/b/x", "D:/b/x"],
]);

describe("buildProjectRows", () => {
  it("counts active, waiting and unseen-completed per root and disambiguates twins", () => {
    const rows = buildProjectRows({
      sessions: [
        session({ id: "1" }),
        session({ id: "2", awaiting_input_since: "2026-09-15T10:05:00Z" }),
        session({ id: "3", status: "completed", ended_at: "2026-09-15T11:00:00Z" }),
        session({ id: "4", status: "completed", ended_at: "2026-09-15T09:00:00Z" }),
        session({ id: "5", cwd: "D:/b/x", last_activity: "2026-09-15T12:00:00Z" }),
      ],
      rootByCwd,
      labelOf: (r) => r.split("/").pop()!,
      dotOf: () => "bg-x",
      seenAt: { "D:/a/x": "2026-09-15T10:30:00Z" },
      countOf: (r) => (r === "D:/a/x" ? 4 : 1),
    });
    const a = rows.find((r) => r.root === "D:/a/x")!;
    expect([a.active, a.waiting, a.unseenDone, a.count]).toEqual([1, 1, 1, 4]);
    expect(rows.map((r) => r.label).sort()).toEqual(["a/x", "b/x"]);
    expect(sortRows(rows, "recent")[0]?.root).toBe("D:/b/x");
    expect(sortRows(rows, "count")[0]?.root).toBe("D:/a/x");
  });

  it("leaves unique labels alone", () => {
    expect(disambiguate([{ root: "D:/a/x", label: "x" }])[0]?.label).toBe("x");
  });

  it("parses the comma list", () => {
    expect(parseProjectParam("a,b")).toEqual(["a", "b"]);
    expect(parseProjectParam(null)).toEqual([]);
  });
});

describe("ProjectPanel", () => {
  const rows: ProjectRow[] = [
    {
      root: "D:/a",
      label: "alpha",
      dot: "",
      count: 2,
      active: 1,
      waiting: 0,
      unseenDone: 0,
      lastActivity: "",
    },
    {
      root: "D:/b",
      label: "beta",
      dot: "",
      count: 1,
      active: 0,
      waiting: 1,
      unseenDone: 0,
      lastActivity: "",
    },
  ];

  it("toggles roots into a multi-selection and filters by search", () => {
    const onChange = vi.fn();
    render(<ProjectPanel rows={rows} selected={["D:/a"]} onChange={onChange} total={3} />);
    fireEvent.click(screen.getByTitle("D:/b"));
    expect(onChange).toHaveBeenCalledWith(["D:/a", "D:/b"]);
    fireEvent.click(screen.getByTitle("D:/a"));
    expect(onChange).toHaveBeenCalledWith([]);
    fireEvent.change(screen.getByLabelText("projectPanel.search"), { target: { value: "bet" } });
    expect(screen.queryByTitle("D:/a")).toBeNull();
    expect(screen.getByTitle("D:/b")).toBeTruthy();
  });
});
