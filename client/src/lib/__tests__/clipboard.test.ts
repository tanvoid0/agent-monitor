/**
 * @file clipboard.test.ts
 * @description Unit tests for `lib/clipboard.copyText`: the Clipboard API path, the hidden
 * textarea + `execCommand("copy")` fallback, and the success/failure toast announcements.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyText } from "../clipboard";
import { ACTION_TOAST_EVENT } from "../appEvents";

function captureToasts(): string[] {
  const messages: string[] = [];
  window.addEventListener(ACTION_TOAST_EVENT, (e) => {
    messages.push((e as CustomEvent<string>).detail);
  });
  return messages;
}

const execCommand = vi.fn<(command: string) => boolean>();

beforeEach(() => {
  execCommand.mockReset();
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

describe("copyText", () => {
  it("uses navigator.clipboard.writeText when available and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const toasts = captureToasts();

    await expect(copyText("hello")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommand).not.toHaveBeenCalled();
    expect(toasts).toEqual(["Copied"]);
  });

  it("falls back to a hidden textarea + execCommand when the Clipboard API is missing", async () => {
    execCommand.mockImplementation((cmd) => {
      expect(cmd).toBe("copy");
      const textarea = document.querySelector("textarea");
      expect(textarea?.value).toBe("fallback text");
      return true;
    });
    const toasts = captureToasts();

    await expect(copyText("fallback text")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(document.querySelector("textarea")).toBeNull(); // cleaned up
    expect(toasts).toEqual(["Copied"]);
  });

  it("falls back when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    execCommand.mockReturnValue(true);

    await expect(copyText("x")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("announces failure and resolves false when every path fails", async () => {
    execCommand.mockImplementation(() => {
      throw new Error("unsupported");
    });
    const toasts = captureToasts();

    await expect(copyText("x")).resolves.toBe(false);

    expect(document.querySelector("textarea")).toBeNull();
    expect(toasts).toEqual(["Copy failed"]);
  });
});
