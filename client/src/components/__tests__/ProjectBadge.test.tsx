/**
 * @file ProjectBadge.test.tsx
 * @description Tests for the project grouping helpers (nested cwds and
 * worktrees fold onto the shortest known ancestor, Windows separators
 * normalize) and the badge itself: its label is a project EntityRef link and
 * its open-in-file-manager button is local only, calls
 * `POST /api/sessions/open-cwd`, and never bubbles to the card click.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ProjectBadge, projectRoots, projectColor, normalizeCwd } from "../ProjectBadge";
import { api } from "../../lib/api";

describe("projectRoots", () => {
  it("folds nested cwds and worktrees onto the shortest known ancestor", () => {
    const roots = projectRoots([
      "/work/repo",
      "/work/repo/apps/web",
      "/work/repo/.claude/worktrees/lane-a",
      "/work/other/.worktrees/x",
      "/work/repo-2",
      null,
    ]);
    expect(roots.get("/work/repo")).toBe("/work/repo");
    expect(roots.get("/work/repo/apps/web")).toBe("/work/repo");
    expect(roots.get("/work/repo/.claude/worktrees/lane-a")).toBe("/work/repo");
    // No session ran at /work/other itself — the worktree still names it.
    expect(roots.get("/work/other/.worktrees/x")).toBe("/work/other");
    // A sibling whose name merely starts with the ancestor's is separate.
    expect(roots.get("/work/repo-2")).toBe("/work/repo-2");
  });

  it("never folds projects onto a root, drive, or home directory", () => {
    const roots = projectRoots([
      "/",
      "/Users/dav",
      "/Users/dav/code/a",
      "/Users/dav/code/b",
      "C:\\",
      "C:\\Users\\dav",
      "C:\\Users\\dav\\proj",
      "/home/u/x",
      "/root/y",
    ]);
    expect(roots.get("/")).toBe("/");
    expect(roots.get("/Users/dav")).toBe("/Users/dav");
    expect(roots.get("/Users/dav/code/a")).toBe("/Users/dav/code/a");
    expect(roots.get("/Users/dav/code/b")).toBe("/Users/dav/code/b");
    expect(roots.get("C:\\")).toBe("C:");
    expect(roots.get("C:\\Users\\dav\\proj")).toBe("C:/Users/dav/proj");
    expect(roots.get("/home/u/x")).toBe("/home/u/x");
    expect(roots.get("/root/y")).toBe("/root/y");
  });

  it("normalizes Windows separators so cwds compare", () => {
    expect(normalizeCwd("D:\\code\\repo\\")).toBe("D:/code/repo");
    const roots = projectRoots(["D:\\code\\repo", "D:\\code\\repo\\apps"]);
    expect(roots.get("D:/code/repo/apps")).toBe("D:/code/repo");
  });

  it("colours are stable per root and differ across roots", () => {
    expect(projectColor("/a/b")).toBe(projectColor("/a/b"));
    expect(projectColor("/a/b")).not.toBe(projectColor("/a/c"));
  });
});

describe("ProjectBadge", () => {
  it("shows the group name, the sub-path, and opens the folder without bubbling", async () => {
    const openCwd = vi.spyOn(api.sessions, "openCwd").mockResolvedValue({ ok: true, cwd: "" });
    const onCard = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={onCard}>
          <ProjectBadge cwd="/work/repo/apps/web" root="/work/repo" />
        </div>
      </MemoryRouter>
    );
    const label = screen.getByTitle("/work/repo/apps/web");
    expect(label).toHaveTextContent("repo · apps/web");
    // The label is the project EntityRef: it links to the sessions list for this cwd.
    expect(label).toHaveAttribute("href", "/sessions?cwd=%2Fwork%2Frepo%2Fapps%2Fweb");
    fireEvent.click(screen.getByRole("button", { name: "Open folder in file manager" }));
    await waitFor(() => expect(openCwd).toHaveBeenCalledWith("/work/repo/apps/web"));
    expect(onCard).not.toHaveBeenCalled();
    openCwd.mockRestore();
  });

  it("hides the open button for sessions from a remote source", () => {
    render(
      <MemoryRouter>
        <ProjectBadge cwd="/work/repo" source="peer-1" />
      </MemoryRouter>
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
