/**
 * @file routes.ts
 * @description Typed href builders for every dashboard page. Pure functions: each takes
 * the page's optional query fields, `encodeURIComponent`s every value, omits empty ones,
 * and returns the path string (query before hash) that `<Link to>`, `navigate()` and
 * `absoluteHref` consume — so no caller assembles `?tab=…&event=…` strings by hand and
 * the param names live in exactly one place.
 * @author Tanveer Hoque <tanvoid0@gmail.com>
 */

type Param = string | number | boolean | string[] | null | undefined;

/** `?a=1&b=2` from an ordered record; skips undefined/null/""/false; `true` → `1`;
 * arrays become repeated params (`cwd=a&cwd=b`) so values may contain commas. */
function qs(params: Record<string, Param>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === undefined || v === null || v === "" || v === false) continue;
      parts.push(`${key}=${encodeURIComponent(v === true ? "1" : String(v))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

type SessionTab = "agents" | "conversation" | "timeline";
type AnalyticsTab = "cost" | "tokens" | "productivity" | "workflow";

export const routes = {
  sessions: (q?: { status?: string; cwd?: string | string[]; q?: string }) =>
    `/sessions${qs({ status: q?.status, cwd: q?.cwd, q: q?.q })}`,

  /** Deep links force the tab they belong to: `agent` → agents (+ `#agent-<id>` hash),
   * `transcript` → conversation, `event`/`tool_name`/`agent_id` → timeline. */
  session: (
    id: string,
    q?: {
      tab?: SessionTab;
      agent?: string;
      event?: number | string;
      transcript?: string;
      tool_name?: string;
      agent_id?: string;
    }
  ) => {
    const tab: SessionTab | undefined = q?.agent
      ? "agents"
      : q?.transcript
        ? "conversation"
        : (q?.event ?? "") !== "" || q?.tool_name || q?.agent_id
          ? "timeline"
          : q?.tab;
    const query = qs({
      tab,
      event: q?.event,
      transcript: q?.transcript,
      tool_name: q?.tool_name,
      agent_id: q?.agent_id,
    });
    const hash = q?.agent ? `#agent-${encodeURIComponent(q.agent)}` : "";
    return `/sessions/${encodeURIComponent(id)}${query}${hash}`;
  },

  kanban: (q?: { view?: "agents" | "sessions"; project?: string; density?: "cards" | "rows" }) =>
    `/kanban${qs({ view: q?.view, project: q?.project, density: q?.density })}`,

  /** Lists are comma-joined by the caller (ids and tool names are comma-safe). */
  activity: (q?: {
    session?: string;
    agent?: string;
    tool?: string;
    type?: string;
    status?: string;
    q?: string;
    from?: string;
    to?: string;
  }) =>
    `/activity${qs({
      session_id: q?.session,
      agent_id: q?.agent,
      tool_name: q?.tool,
      event_type: q?.type,
      status: q?.status,
      q: q?.q,
      from: q?.from,
      to: q?.to,
    })}`,

  analytics: (q?: { tab?: AnalyticsTab }) => `/analytics${qs({ tab: q?.tab })}`,

  plan: (slug?: string, q?: { task?: string }) =>
    `/plan${slug ? `/${encodeURIComponent(slug)}` : ""}${qs({ task: q?.task })}`,

  run: (q?: { session?: string; prompt?: string; autostart?: boolean; cwd?: string }) =>
    `/run${qs({ session: q?.session, prompt: q?.prompt, autostart: q?.autostart, cwd: q?.cwd })}`,

  settings: (
    section?: "alerts" | "import" | "remote-sources" | "claude-pricing" | "gpt-pricing" | string
  ) => `/settings${section ? `#${encodeURIComponent(section)}` : ""}`,
};

/** Absolute URL for sharing / "Copy link": `window.location.origin + href`. */
export function absoluteHref(href: string): string {
  return `${window.location.origin}${href}`;
}
