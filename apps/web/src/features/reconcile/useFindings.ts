import { type Ref } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import type { FindingQueueState, FindingRow, FindingKind } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

/**
 * The Findings inbox — both case tables, one queue (C7b).
 *
 * The merge happens on the SERVER (`findingsRead.ts`) and not here, which is the point rather than an
 * implementation detail: the two tables disagree about how to name a truck, what a date means and
 * what closing is, and every one of those is a place a row can be quietly dropped. Doing it in the
 * browser would mean two requests, two failure modes, and a page that has to decide what a half-loaded
 * queue looks like. One request answers with rows already on one axis.
 *
 * ⚠ The section gate is per ROW and is applied server-side, so this composable asks for everything and
 * receives only what the caller may see. There is deliberately no client-side filtering of kinds by
 * section — a client that filters is a client that could stop filtering.
 */

export interface FindingsQuery {
  states: FindingQueueState[];
  kinds: FindingKind[];
  vehicleIds: string[];
  assignedTo: string | null;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

export interface FindingsPage {
  rows: FindingRow[];
  total: number;
  /** A source hit the server's read cap; the list below may be missing findings. */
  truncated: boolean;
}

export function findingsQs(q: FindingsQuery): string {
  const p = new URLSearchParams();
  if (q.states.length) p.set("state", q.states.join(","));
  if (q.kinds.length) p.set("kind", q.kinds.join(","));
  if (q.vehicleIds.length) p.set("vehicles", q.vehicleIds.join(","));
  if (q.assignedTo) p.set("assignedTo", q.assignedTo);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  p.set("limit", String(q.pageSize));
  p.set("offset", String((q.page - 1) * q.pageSize));
  return p.toString();
}

export function useFindingsQuery(query: Ref<FindingsQuery>) {
  return useQuery({
    queryKey: ["findings", query],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async (): Promise<FindingsPage> => {
      const res = await apiFetch<{ ok: boolean; rows: FindingRow[]; total: number; truncated: boolean }>(
        `/api/fueling/findings?${findingsQs(query.value)}`,
      );
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load findings");
      return { rows: res.data.rows ?? [], total: res.data.total ?? 0, truncated: Boolean(res.data.truncated) };
    },
  });
}
