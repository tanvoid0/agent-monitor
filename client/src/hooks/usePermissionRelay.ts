/**
 * @file usePermissionRelay.ts
 * @description Shared client half of the permission relay: keeps the list of
 * parked Claude Code permission prompts in sync (GET /api/permissions on mount
 * and on every reconnect, `permission_request` / `permission_resolved` pushes
 * in between) and posts decisions. Both surfaces that can answer a prompt — the
 * global floating cards and the per-session banner on the session detail page —
 * consume this, so a decision taken in one place clears the other.
 *
 * The 1s re-render that drives the expiry countdown only runs while something
 * is actually pending.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { eventBus } from "../lib/eventBus";
import type { PermissionRequest, PermissionResolvedPayload, PermissionUpdate } from "../lib/types";

export type PermissionBehavior = "allow" | "deny" | "defer";

export interface PermissionRelayState {
  /** Every prompt the relay is currently holding, oldest first. */
  pending: PermissionRequest[];
  /** Id of the request whose decision is in flight, or null. */
  busy: string | null;
  /** Per-request error text from a failed decision POST. */
  errors: Record<string, string>;
  decide: (
    id: string,
    behavior: PermissionBehavior,
    updatedPermissions?: PermissionUpdate[]
  ) => Promise<void>;
}

export function usePermissionRelay(): PermissionRelayState {
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);

  useEffect(() => {
    const refetch = () =>
      api.permissions
        .list()
        .then((r) => setPending(r.pending))
        .catch(() => {});
    refetch();
    const unsubMessages = eventBus.subscribe((msg) => {
      if (msg.type === "permission_request") {
        const req = msg.data as PermissionRequest;
        setPending((prev) => (prev.some((p) => p.id === req.id) ? prev : [...prev, req]));
      } else if (msg.type === "permission_resolved") {
        const { id } = msg.data as PermissionResolvedPayload;
        setPending((prev) => prev.filter((p) => p.id !== id));
      }
    });
    // A server restart drops the in-memory queue without a resolved push.
    const unsubConnection = eventBus.onConnection((connected) => {
      if (connected) refetch();
    });
    return () => {
      unsubMessages();
      unsubConnection();
    };
  }, []);

  // Drive the countdown only while something is on screen.
  useEffect(() => {
    if (!pending.length) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [pending.length]);

  const decide = useCallback(
    async (id: string, behavior: PermissionBehavior, updatedPermissions?: PermissionUpdate[]) => {
      setBusy(id);
      try {
        await api.permissions.decide(id, { behavior, updatedPermissions });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/no pending permission/i.test(message)) {
          // Already answered, expired, or dropped by a restart — nothing to do.
          setPending((prev) => prev.filter((p) => p.id !== id));
        } else {
          setErrors((prev) => ({ ...prev, [id]: message }));
        }
      } finally {
        setBusy(null);
      }
    },
    []
  );

  return { pending, busy, errors, decide };
}
