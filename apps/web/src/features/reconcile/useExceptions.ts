/**
 * The exception ledger, read and moved.
 *
 * Everything goes through the API rather than PostgREST, and not for consistency's sake: moving a
 * finding has to write an act-log row in the same breath, and `fuel_exceptions` carries no client
 * write policy at all so a browser could not do it anyway. A read could have gone direct; keeping both
 * on one door means the list and the thing that changes it cannot drift apart about what a status is.
 */
import { computed, type Ref } from "vue";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { FuelExceptionKind, FuelExceptionStatus } from "@fuelguard/shared";
import { apiFetch } from "@/lib/api";

export interface FuelException {
  id: string;
  kind: FuelExceptionKind;
  run_id: string | null;
  transaction_id: string | null;
  occurred_on: string | null;
  amount: number | string;
  amount_kind: string;
  unit_number: string | null;
  site_number: string | null;
  city: string | null;
  state: string | null;
  brand: string | null;
  evidence: Record<string, unknown>;
  fingerprint: string;
  status: FuelExceptionStatus;
  assigned_to: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  credited_amount: number | string | null;
  credited_on: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface FuelExceptionEvent {
  id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

/**
 * identified / claimed / recovered — three numbers, never one.
 *
 * The figure that renews a contract is not "we found $14,200", it is "we recovered $14,200", and a
 * product reporting only the first can never prove itself. `byKind` keeps the four kinds of money
 * apart on top of that, because recoverable, owed and unexplained must not be added (D-FX5).
 */
export interface ExceptionTotals {
  identified: number;
  claimed: number;
  recovered: number;
  lines: number;
  openLines: number;
  byKind: Record<string, { identified: number; lines: number }>;
}

export interface ExceptionQuery {
  status: FuelExceptionStatus[];
  kind: FuelExceptionKind[];
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

const qs = (q: ExceptionQuery): string => {
  const p = new URLSearchParams({ from: q.from, to: q.to, limit: String(q.pageSize), offset: String((q.page - 1) * q.pageSize) });
  if (q.status.length) p.set("status", q.status.join(","));
  if (q.kind.length) p.set("kind", q.kind.join(","));
  return p.toString();
};

export function useExceptionsQuery(query: Ref<ExceptionQuery>) {
  return useQuery({
    queryKey: ["fuel_exceptions", query],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async (): Promise<{ rows: FuelException[]; total: number }> => {
      const res = await apiFetch<{ ok: boolean; exceptions: FuelException[]; total: number }>(
        `/api/fueling/exceptions?${qs(query.value)}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the ledger");
      return { rows: res.data.exceptions ?? [], total: res.data.total ?? 0 };
    },
  });
}

export function useExceptionTotalsQuery(window: Ref<{ from: string; to: string }>) {
  return useQuery({
    queryKey: ["fuel_exception_totals", window],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async (): Promise<ExceptionTotals | null> => {
      const p = new URLSearchParams({ from: window.value.from, to: window.value.to });
      const res = await apiFetch<{ ok: boolean; totals: ExceptionTotals }>(`/api/fueling/exceptions/totals?${p}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the totals");
      return res.data.totals;
    },
  });
}

/** One finding with its act log — the slide-over's whole payload in one round trip. */
export function useExceptionQuery(id: Ref<string | null>) {
  return useQuery({
    queryKey: ["fuel_exception", id],
    enabled: computed(() => id.value != null),
    queryFn: async (): Promise<{ exception: FuelException; events: FuelExceptionEvent[] } | null> => {
      if (!id.value) return null;
      const res = await apiFetch<{ ok: boolean; exception: FuelException; events: FuelExceptionEvent[] }>(
        `/api/fueling/exceptions/${id.value}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not open that finding");
      return { exception: res.data.exception, events: res.data.events ?? [] };
    },
  });
}

export interface MoveInput {
  id: string;
  status?: FuelExceptionStatus;
  assignedTo?: string | null;
  note?: string;
  creditedAmount?: number | null;
  creditedOn?: string | null;
}

export function useMoveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: MoveInput) => {
      const res = await apiFetch<{ ok: boolean; exception: FuelException }>(`/api/fueling/exceptions/${id}`, {
        method: "PATCH",
        body,
      });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not move that finding");
      return res.data.exception;
    },
    onSuccess: () => {
      // The list, the totals and the open finding all change together — a status move that left the
      // header saying the old recovered figure would be the first thing a reader stopped trusting.
      void qc.invalidateQueries({ queryKey: ["fuel_exceptions"] });
      void qc.invalidateQueries({ queryKey: ["fuel_exception_totals"] });
      void qc.invalidateQueries({ queryKey: ["fuel_exception"] });
    },
  });
}
