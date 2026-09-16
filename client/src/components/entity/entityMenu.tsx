/**
 * @file entityMenu.tsx
 * @description The domain half of the entity chip: the `EntityTarget` union
 * (session, agent, project, tool, event type, model, event), the primary href
 * and raw value of each, the project label/sub-path split, and `entityMenu`,
 * which builds the context-menu items (open/show/copy/reveal) for a target
 * from `lib/routes`, a copy function and an optional folder opener.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import type { TFunction } from "i18next";
import { absoluteHref, routes } from "../../lib/routes";
import { revealCwd } from "../../lib/project";
import type { MenuItem } from "../ui";

export type EntityTarget =
  | {
      kind: "session";
      id: string;
      name?: string | null;
      cwd?: string | null;
      source?: string | null;
      /** Pre-identity Codex process: no link, no menu. */
      transient?: boolean;
    }
  | {
      kind: "agent";
      id: string;
      sessionId: string;
      /** `"main"` opens the main transcript; anything else opens the agent's own. */
      type: string | null | undefined;
      name?: string | null;
    }
  | { kind: "project"; cwd: string; source?: string | null }
  | { kind: "tool"; name: string; sessionId?: string }
  | { kind: "eventType"; type: string }
  | { kind: "model"; model: string }
  | {
      kind: "event";
      id: number | string;
      sessionId: string;
      toolName?: string | null;
      agentId?: string | null;
    };

export interface EntityMenuCtx {
  t: TFunction;
  copy: (text: string) => Promise<boolean>;
  /** Defaults to `api.sessions.openCwd`, dereferenced when the item is selected. */
  openCwd?: (cwd: string) => Promise<unknown>;
}

/** Where the chip links and what "Copy link" copies. */
export function entityHref(ref: EntityTarget): string {
  switch (ref.kind) {
    case "session":
      return routes.session(ref.id);
    case "agent":
      return routes.session(ref.sessionId, { agent: ref.id });
    case "project":
      return routes.sessions({ cwd: ref.cwd });
    case "tool":
      return routes.activity({ tool: ref.name, session: ref.sessionId });
    case "eventType":
      return routes.activity({ type: ref.type });
    case "model":
      return routes.analytics({ tab: "cost" });
    case "event":
      return routes.session(ref.sessionId, { event: ref.id });
  }
}

/** Full raw value: the chip's `title` and the menu's first (label) line. */
export function entityValue(ref: EntityTarget): string {
  switch (ref.kind) {
    case "session":
    case "agent":
      return ref.id;
    case "event":
      return String(ref.id);
    case "project":
      return ref.cwd;
    case "tool":
      return ref.name;
    case "eventType":
      return ref.type;
    case "model":
      return ref.model;
  }
}

const isLocal = (source: string | null | undefined) => !source || source === "local";

const SEP: MenuItem = { type: "separator" };

export function entityMenu(ref: EntityTarget, ctx: EntityMenuCtx): MenuItem[] {
  const { t, copy } = ctx;
  const m = (key: string) => t(`common:ui.menu.${key}`);
  const href = entityHref(ref);
  const link = (key: string, to: string): MenuItem => ({ label: m(key), to });
  const copyItem = (key: string, text: () => string): MenuItem => ({
    label: m(key),
    onSelect: async () => {
      await copy(text());
    },
  });
  const copyLink = copyItem("copyLink", () => absoluteHref(href));
  const reveal = (cwd: string): MenuItem => ({
    label: m("revealFolder"),
    onSelect: () => revealCwd(cwd, t, undefined, ctx.openCwd),
  });

  const items: (MenuItem | false | null | undefined | "")[] = [
    { type: "label", label: entityValue(ref) },
  ];
  switch (ref.kind) {
    case "session": {
      const { id, cwd, source } = ref;
      items.push(
        link("open", href),
        link("openConversation", routes.session(id, { transcript: "main" })),
        link("openTimeline", routes.session(id, { tab: "timeline" })),
        SEP,
        link("showInActivity", routes.activity({ session: id })),
        cwd && link("sessionsInProject", routes.sessions({ cwd })),
        cwd && link("showOnBoard", routes.kanban({ project: cwd })),
        link("resumeInRun", routes.run({ session: id })),
        SEP,
        copyItem("copySessionId", () => id),
        cwd && copyItem("copyPath", () => cwd),
        copyLink,
        cwd && isLocal(source) && reveal(cwd)
      );
      break;
    }
    case "agent": {
      const { id, sessionId, type } = ref;
      const isMain = type === "main" || (type == null && id.endsWith("-main"));
      items.push(
        link("openConversation", routes.session(sessionId, { transcript: isMain ? "main" : id })),
        link("openEvents", routes.session(sessionId, { agent_id: id })),
        link("openSession", routes.session(sessionId)),
        link("showInActivity", routes.activity({ agent: id })),
        SEP,
        copyItem("copyAgentId", () => id),
        copyItem("copySessionId", () => sessionId),
        copyLink
      );
      break;
    }
    case "project": {
      const { cwd, source } = ref;
      items.push(
        link("sessionsInProject", href),
        link("showOnBoard", routes.kanban({ project: cwd })),
        SEP,
        copyItem("copyPath", () => cwd),
        isLocal(source) && reveal(cwd)
      );
      break;
    }
    case "tool": {
      const { name, sessionId } = ref;
      items.push(
        link("showInActivity", href),
        sessionId && link("filterByTool", routes.session(sessionId, { tool_name: name })),
        SEP,
        copyItem("copyToolName", () => name)
      );
      break;
    }
    case "eventType":
      items.push(
        link("showInActivity", href),
        SEP,
        copyItem("copyEventType", () => ref.type)
      );
      break;
    case "model":
      items.push(
        link("costAnalytics", href),
        link(
          "pricingRules",
          routes.settings(/^(gpt|o\d|codex)/i.test(ref.model) ? "gpt-pricing" : "claude-pricing")
        ),
        SEP,
        copyItem("copyModelId", () => ref.model)
      );
      break;
    case "event": {
      const { id, sessionId, toolName, agentId } = ref;
      items.push(
        link("openTimeline", href),
        link("showInActivity", routes.activity({ session: sessionId })),
        toolName && link("filterByTool", routes.session(sessionId, { tool_name: toolName })),
        agentId && link("openAgent", routes.session(sessionId, { agent: agentId })),
        SEP,
        copyItem("copyEventId", () => String(id)),
        copyLink
      );
      break;
    }
  }
  return items.filter((item): item is MenuItem => Boolean(item));
}
