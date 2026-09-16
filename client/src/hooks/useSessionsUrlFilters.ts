/**
 * @file useSessionsUrlFilters.ts
 * @description Single owner of the Sessions list's URL-backed filters:
 * `?status=` (one of the known status filters, `""` meaning "all"), repeated
 * `?cwd=` project paths, and the `?q=` search seed. Every write goes through
 * one `setSearchParams` updater with `replace`, so multi-key changes such as
 * "clear filters" are atomic by construction — two independent functional
 * writers in the same tick would each derive from the render-time params and
 * the second would restore what the first removed.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

/** Status filters in render order — also the order `1`…`6` addresses them.
 *  `""` is the "all" pseudo-filter the server treats as no status constraint. */
export const SESSION_FILTERS = [
  "",
  "active",
  "waiting",
  "completed",
  "error",
  "abandoned",
] as const;

export type SessionFilter = (typeof SESSION_FILTERS)[number];

export interface SessionsUrlFilters {
  /** Active status filter; `""` when the URL carries none (or an unknown one). */
  status: SessionFilter;
  /** Project filter as the exact stored `cwd` strings, in URL order. */
  cwds: string[];
  /** Initial search text from `?q=`; read once by the page to seed its box. */
  q: string;
  setStatus: (status: SessionFilter) => void;
  setCwds: (cwds: string[]) => void;
  /** Drops `status` and every `cwd` in one URL write. */
  clear: () => void;
}

const isSessionFilter = (value: string | null): value is SessionFilter =>
  value !== null && (SESSION_FILTERS as readonly string[]).includes(value);

/**
 * Read and write the Sessions page's URL filters through one updater.
 *
 * Paths may contain commas, so projects travel as repeated `?cwd=` params
 * rather than a delimited list. `cwds` is memoised on the joined value because
 * `getAll` returns a fresh array per render and callers key fetches off it.
 * Writes use `replace` so Back walks pages, not filter states.
 */
export function useSessionsUrlFilters(): SessionsUrlFilters {
  const [searchParams, setSearchParams] = useSearchParams();

  const fromUrl = searchParams.get("status");
  const status: SessionFilter = isSessionFilter(fromUrl) ? fromUrl : "";
  const cwdKey = searchParams.getAll("cwd").join("\0");
  const cwds = useMemo(() => (cwdKey ? cwdKey.split("\0") : []), [cwdKey]);
  const q = searchParams.get("q") ?? "";

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          mutate(next);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setStatus = useCallback(
    (next: SessionFilter) =>
      update((params) => {
        // The "all" pseudo-filter is the absence of the param; writing
        // `?status=` would leave a meaningless key in every copied link.
        if (next === "") params.delete("status");
        else params.set("status", next);
      }),
    [update]
  );

  const setCwds = useCallback(
    (next: string[]) =>
      update((params) => {
        params.delete("cwd");
        for (const cwd of next) params.append("cwd", cwd);
      }),
    [update]
  );

  const clear = useCallback(
    () =>
      update((params) => {
        params.delete("status");
        params.delete("cwd");
      }),
    [update]
  );

  return { status, cwds, q, setStatus, setCwds, clear };
}
