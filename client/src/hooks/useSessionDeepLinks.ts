/**
 * @file useSessionDeepLinks.ts
 * @description The three deep-link state machines of the session detail page,
 * kept out of the page so their once-per-navigation guards can be reasoned
 * about (and tested) in isolation:
 *  - `?tool_name=` / `?agent_id=` seed the timeline filters once per
 *    `location.key`, then leave the URL (replace) so a later tab switch cannot
 *    re-apply them;
 *  - `?event=<id>` expands + scrolls to the row once the first batch is in,
 *    pulling one more batch and retrying if the row is not loaded yet, and
 *    announcing when it still cannot be found;
 *  - `#agent-<id>` expands the target and every ancestor, then scrolls to and
 *    rings the card once it exists in the DOM.
 * The page keeps ownership of the underlying state; this hook only drives it.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router";
import type { Dispatch, SetStateAction } from "react";
import type { EventFiltersValue } from "../components/EventFilters";
import type { Agent, DashboardEvent } from "../lib/types";

/** How long a deep-link target keeps its accent ring after scrolling to it. */
const DEEP_LINK_RING_MS = 1500;

/**
 * Scroll a deep-link target into view, ring it briefly, and move focus onto
 * it. Waits two frames: the caller's ancestor-expansion setState (expanding
 * collapsed agent nodes) commits after the first frame, so the target may not
 * exist in the DOM yet on frame one.
 */
export function flashElement(elementId: string) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(elementId);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      (el.querySelector<HTMLElement>("button,a") ?? el).focus({ preventScroll: true });
      el.classList.add("ring-2", "ring-accent/60");
      setTimeout(() => el.classList.remove("ring-2", "ring-accent/60"), DEEP_LINK_RING_MS);
    });
  });
}

/** `#agent-<id>` → `<id>`; empty for any other (or malformed) hash. */
export function agentIdFromHash(hash: string): string {
  if (!hash.startsWith("#agent-")) return "";
  try {
    return decodeURIComponent(hash.slice("#agent-".length));
  } catch {
    return "";
  }
}

export interface SessionDeepLinksOptions {
  /** Route `:id`; bookkeeping resets when it changes (the page is not remounted). */
  sessionId: string | undefined;
  agents: Agent[];
  events: DashboardEvent[];
  eventsTotal: number;
  eventsLoaded: boolean;
  eventsLoadingMore: boolean;
  expandedAgents: Set<string>;
  loadMoreEvents: () => Promise<void>;
  setFilters: Dispatch<SetStateAction<EventFiltersValue>>;
  setExpandedEvents: Dispatch<SetStateAction<Set<number>>>;
  setExpandedAgents: Dispatch<SetStateAction<Set<string>>>;
  /** Called with the `?event=` value when it cannot be loaded into the timeline. */
  onEventNotLoaded: (eventId: string) => void;
}

export function useSessionDeepLinks({
  sessionId,
  agents,
  events,
  eventsTotal,
  eventsLoaded,
  eventsLoadingMore,
  expandedAgents,
  loadMoreEvents,
  setFilters,
  setExpandedEvents,
  setExpandedAgents,
  onEventNotLoaded,
}: SessionDeepLinksOptions): void {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── `?tool_name=` / `?agent_id=` — one-shot filter seeds ────────────────
  const seededFiltersKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (seededFiltersKeyRef.current === location.key) return;
    seededFiltersKeyRef.current = location.key;
    const toolName = searchParams.get("tool_name");
    const agentId = searchParams.get("agent_id");
    if (!toolName && !agentId) return;
    setFilters((prev) => ({
      ...prev,
      tool_name: toolName ? [toolName] : prev.tool_name,
      agent_id: agentId ? [agentId] : prev.agent_id,
    }));
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("tool_name");
        next.delete("agent_id");
        return next;
      },
      { replace: true }
    );
  }, [location.key, searchParams, setSearchParams, setFilters]);

  // ── `?event=<id>` — expand + scroll once the row is loaded ──────────────
  // Runs once per `event` value and never touches the filters.
  const eventParam = searchParams.get("event");
  const handledEventRef = useRef<string | null>(null);
  const eventRetriedRef = useRef<string | null>(null);
  // /sessions/A → /sessions/B only changes `id`; without this the previous
  // session's deep-link bookkeeping would leak into the new one.
  useEffect(() => {
    handledEventRef.current = null;
    eventRetriedRef.current = null;
  }, [sessionId]);
  const onEventNotLoadedRef = useRef(onEventNotLoaded);
  onEventNotLoadedRef.current = onEventNotLoaded;
  useEffect(() => {
    if (!eventParam || !eventsLoaded || eventsLoadingMore) return;
    if (handledEventRef.current === eventParam) return;
    const eventId = Number(eventParam);
    if (events.some((e) => e.id === eventId)) {
      handledEventRef.current = eventParam;
      setExpandedEvents((prev) => new Set(prev).add(eventId));
      flashElement(`event-${eventId}`);
      return;
    }
    if (eventRetriedRef.current !== eventParam && events.length < eventsTotal) {
      eventRetriedRef.current = eventParam;
      void loadMoreEvents();
      return;
    }
    handledEventRef.current = eventParam;
    onEventNotLoadedRef.current(eventParam);
  }, [
    eventParam,
    events,
    eventsTotal,
    eventsLoaded,
    eventsLoadingMore,
    loadMoreEvents,
    setExpandedEvents,
  ]);

  // ── `#agent-<id>` — expand ancestors, then flash the card ───────────────
  // Runs once per navigation (location.key) per hash value. Split in two: the
  // card nested under a collapsed ancestor does not exist in the DOM yet when
  // `setExpandedAgents` and `flashElement` run in the same pass, so the rAF
  // inside `flashElement` can fire before the expansion has committed and
  // rendered the target. Effect 1 marks the hash handled and queues the
  // flash; effect 2 fires it once the target element exists.
  const agentHash = agentIdFromHash(location.hash);
  const handledAgentHashRef = useRef<string | null>(null);
  const pendingFlashRef = useRef<string | null>(null);
  useEffect(() => {
    const token = `${location.key}:${agentHash}`;
    if (!agentHash || agents.length === 0 || handledAgentHashRef.current === token) return;
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    if (!agentMap.has(agentHash)) return;
    handledAgentHashRef.current = token;
    const toExpand = new Set<string>();
    let cur: string | null | undefined = agentHash;
    while (cur && !toExpand.has(cur)) {
      toExpand.add(cur);
      cur = agentMap.get(cur)?.parent_agent_id;
    }
    setExpandedAgents((prev) => new Set([...prev, ...toExpand]));
    pendingFlashRef.current = agentHash;
  }, [agents, agentHash, location.key, setExpandedAgents]);
  useEffect(() => {
    const pending = pendingFlashRef.current;
    if (!pending || pending !== agentHash) return;
    if (!document.getElementById(`agent-${pending}`)) return;
    pendingFlashRef.current = null;
    flashElement(`agent-${pending}`);
  }, [expandedAgents, agentHash]);
}
