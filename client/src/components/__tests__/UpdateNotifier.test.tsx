/**
 * @file UpdateNotifier.test.tsx
 * @description Tests the check-failure path (#108): a fetch error from an
 * explicit check (simulated via an `update_status` WS broadcast) opens the
 * modal with detail and a retry button, while the same error arriving from
 * the silent mount read never does. Also covers the normal update-available
 * path and dismissal.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { UpdateNotifier } from "../UpdateNotifier";
import { eventBus } from "../../lib/eventBus";
import { api } from "../../lib/api";
import type { UpdateStatusPayload } from "../../lib/types";

vi.mock("../../lib/api", () => ({
  api: { updates: { status: vi.fn(), check: vi.fn() } },
}));

const statusMock = api.updates.status as unknown as ReturnType<typeof vi.fn>;
const checkMock = api.updates.check as unknown as ReturnType<typeof vi.fn>;

const NO_UPDATE: UpdateStatusPayload = { git_repo: true, update_available: false };
const FETCH_ERROR: UpdateStatusPayload = {
  git_repo: true,
  update_available: false,
  fetch_error: "fetch failed",
  message: "Could not reach origin; try again when online.",
};

beforeEach(() => {
  localStorage.clear();
  statusMock.mockReset().mockResolvedValue(NO_UPDATE);
  checkMock.mockReset();
});

describe("UpdateNotifier", () => {
  it("renders nothing when the silent mount read fails", async () => {
    statusMock.mockResolvedValue(FETCH_ERROR);
    render(<UpdateNotifier />);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with detail and a retry button when an explicit check fails (#108)", async () => {
    render(<UpdateNotifier />);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());

    act(() => {
      eventBus.publish({
        type: "update_status",
        data: FETCH_ERROR,
        timestamp: new Date().toISOString(),
      });
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Update check failed");
    expect(dialog).toHaveTextContent(FETCH_ERROR.message as string);
    expect(screen.getByRole("button", { name: /check now/i })).toBeInTheDocument();
  });

  it("closes once a retried check succeeds", async () => {
    render(<UpdateNotifier />);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    act(() => {
      eventBus.publish({
        type: "update_status",
        data: FETCH_ERROR,
        timestamp: new Date().toISOString(),
      });
    });
    await screen.findByRole("dialog");

    checkMock.mockResolvedValue(NO_UPDATE);
    screen.getByRole("button", { name: /check now/i }).click();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("still shows the normal update-available modal, unaffected by the error path", async () => {
    statusMock.mockResolvedValue({
      git_repo: true,
      update_available: true,
      remote_sha: "abc1234",
      remote_ref: "origin/main",
      commits_behind: 3,
    });
    render(<UpdateNotifier />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Dashboard update available");
  });
});
