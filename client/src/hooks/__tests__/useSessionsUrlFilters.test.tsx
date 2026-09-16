/**
 * @file useSessionsUrlFilters.test.tsx
 * @description Tests for the Sessions page's single URL-filter owner: reading
 * `?status=` / repeated `?cwd=` / `?q=`, ignoring unknown statuses, writing
 * each key without disturbing the others, and clearing status + cwd in one
 * atomic write (the clobber the previous two-writer layout produced).
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { useSessionsUrlFilters } from "../useSessionsUrlFilters";

function setup(initial: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ filters: useSessionsUrlFilters(), search: useLocation().search }), {
    wrapper,
  });
}

describe("useSessionsUrlFilters", () => {
  it("reads status, repeated cwd and q from the URL", () => {
    const { result } = setup("/sessions?status=error&cwd=%2Fa%2Cb&cwd=%2Fc&q=hello");
    expect(result.current.filters.status).toBe("error");
    expect(result.current.filters.cwds).toEqual(["/a,b", "/c"]);
    expect(result.current.filters.q).toBe("hello");
  });

  it("treats an unknown status as the all pseudo-filter", () => {
    const { result } = setup("/sessions?status=bogus");
    expect(result.current.filters.status).toBe("");
  });

  it("writes one key without touching the others and drops status when set to all", () => {
    const { result } = setup("/sessions?status=active&cwd=%2Fp&q=x");
    act(() => result.current.filters.setCwds(["/q", "/r"]));
    expect(result.current.search).toBe("?status=active&q=x&cwd=%2Fq&cwd=%2Fr");
    act(() => result.current.filters.setStatus(""));
    expect(result.current.search).toBe("?q=x&cwd=%2Fq&cwd=%2Fr");
  });

  it("clears status and every cwd in a single write, keeping q", () => {
    const { result } = setup("/sessions?status=active&cwd=%2Fp&cwd=%2Fr&q=x");
    act(() => result.current.filters.clear());
    expect(result.current.search).toBe("?q=x");
    expect(result.current.filters.status).toBe("");
    expect(result.current.filters.cwds).toEqual([]);
  });
});
