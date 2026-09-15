/**
 * @file api.ts
 * @description Fetch client for `/api/plans` (docs/plan-layer.md §4.5), kept
 * separate from `lib/api.ts` (out of Lane P's touches) but mirroring its
 * conventions: a relative base path, the shared dashboard auth token, and
 * non-2xx responses normalized into a thrown `Error`.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { dashboardToken } from "../lib/api";
import type { PlanModel, PlanListItem } from "./types";

const BASE = "/api/plans";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = dashboardToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { "x-dashboard-token": token } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export const planApi = {
  /** GET /api/plans — the picker's source list. Lane S's exact envelope
   *  isn't built yet (§5 Lane S is the long pole); accept either `{ plans }`
   *  or a bare array so the picker doesn't break on whichever it lands as. */
  list: async (): Promise<PlanListItem[]> => {
    const body = await request<{ plans?: PlanListItem[] } | PlanListItem[]>("");
    return Array.isArray(body) ? body : (body.plans ?? []);
  },
  /** GET /api/plans/:slug/model — the join model rendered by the page. */
  model: (slug: string) => request<PlanModel>(`/${encodeURIComponent(slug)}/model`),
  /** POST /api/plans/:slug/tick — flips one checkbox in PROGRESS.md. */
  tick: (slug: string, key: string, done: boolean) =>
    request<{ ok: boolean }>(`/${encodeURIComponent(slug)}/tick`, {
      method: "POST",
      body: JSON.stringify({ key, done }),
    }),
};
