/**
 * @file clipboard.ts
 * @description The one copy-to-clipboard helper for the dashboard. Uses the async
 * Clipboard API in secure contexts and falls back to a short-lived hidden textarea +
 * `execCommand("copy")` so plain-HTTP and remote-browser sessions keep working, then
 * announces the outcome through the action toast (`common:eventDetail.copied` /
 * `common:ui.copyFailed`).
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

import i18n from "../i18n";
import { announceAction } from "./appEvents";

async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Some embedded or non-secure browser contexts reject Clipboard API access.
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  try {
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/** Copy `value` and toast the result. Resolves `true` when the text reached the clipboard. */
export async function copyText(value: string): Promise<boolean> {
  const ok = await writeClipboard(value);
  announceAction(i18n.t(ok ? "common:eventDetail.copied" : "common:ui.copyFailed"));
  return ok;
}
