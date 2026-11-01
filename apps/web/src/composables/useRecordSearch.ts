import { computed, type Ref } from "vue";
import { refDebounced } from "@vueuse/core";
import { useQuery } from "@tanstack/vue-query";
import {
  DRIVER_STATUS_LABELS,
  EMPLOYED_DRIVER_STATUSES,
  RECORD_SEARCH_LIMIT,
  isInServiceVehicleStatus,
  recordSearchPattern,
  recordSearchTerm,
  type DriverStatus,
  type LoadSearchResponse,
} from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { useOpens } from "@/composables/useOpens";
import type { PaletteEntry } from "@/lib/commandPalette";
import {
  anyColumnIlike,
  detailOf,
  recordEntry,
  searchableKinds,
  type RecordHit,
  type RecordKind,
  type SearchableKind,
} from "@/lib/recordSearch";

/**
 * The palette's record reads (SIDEBAR-REDESIGN-PLAN.md D-SB8). Who may search which kind, and why, is
 * in `lib/recordSearch.ts`; this file only asks.
 *
 * Each read is the one its list page already makes — the same table, the same RLS, the same status
 * rule (Drivers lists the EMPLOYED, so an applicant is found in Recruitment, not here) — narrowed to
 * five rows by the term. A kind that fails is reported by name and the others still answer, so one
 * slow table does not blank the palette.
 */

type Fetcher = (pattern: string, term: string) => Promise<RecordHit[]>;

const rows = <T>({ data, error }: { data: unknown; error: { message: string } | null }): T[] => {
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
};

const FETCHERS: Record<RecordKind, Fetcher> = {
  truck: async (pattern) => {
    type Row = { id: string; unit_number: string; year: number | null; make: string | null; model: string | null; status: string | null };
    const found = rows<Row>(
      await supabase
        .from("vehicles")
        .select("id, unit_number, year, make, model, status")
        .or(anyColumnIlike(["unit_number", "plate", "vin"], pattern))
        .order("unit_number", { ascending: true })
        .limit(RECORD_SEARCH_LIMIT),
    );
    return found.map((v) => ({
      id: v.id,
      name: v.unit_number,
      detail: detailOf(v.year, v.make, v.model, isInServiceVehicleStatus(v.status) ? null : "Not in service"),
    }));
  },
  trailer: async (pattern) => {
    type Row = { id: string; unit_number: string; make: string | null; trailer_type: string | null };
    const found = rows<Row>(
      await supabase
        .from("trailers")
        .select("id, unit_number, make, trailer_type")
        .or(anyColumnIlike(["unit_number", "plate"], pattern))
        .order("unit_number", { ascending: true })
        .limit(RECORD_SEARCH_LIMIT),
    );
    return found.map((t) => ({ id: t.id, name: t.unit_number, detail: detailOf(t.make, t.trailer_type) }));
  },
  driver: async (pattern) => {
    type Row = { id: string; full_name: string; employee_id: string | null; status: DriverStatus };
    const found = rows<Row>(
      await supabase
        .from("drivers")
        .select("id, full_name, employee_id, status")
        .in("status", [...EMPLOYED_DRIVER_STATUSES])
        .or(anyColumnIlike(["full_name", "employee_id"], pattern))
        .order("full_name", { ascending: true })
        .limit(RECORD_SEARCH_LIMIT),
    );
    return found.map((d) => ({
      id: d.id,
      name: d.full_name,
      detail: detailOf(d.employee_id, d.status === "active" ? null : DRIVER_STATUS_LABELS[d.status]),
    }));
  },
  load: async (_pattern, term) => {
    const res = await apiFetch<LoadSearchResponse>(`/api/dispatch/loads/search?q=${encodeURIComponent(term)}`);
    if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not search loads.");
    return res.data.loads.map((l) => ({ id: l.id, name: l.ref, detail: detailOf(l.customer_name, l.driver_name) }));
  },
};

export interface RecordSearchResult {
  entries: PaletteEntry[];
  /** Kinds whose read failed, by noun, so the palette can say which part of the answer is missing. */
  failed: string[];
}

export async function runRecordSearch(term: string, kinds: readonly SearchableKind[]): Promise<RecordSearchResult> {
  const pattern = recordSearchPattern(term);
  const settled = await Promise.allSettled(kinds.map((k) => FETCHERS[k.kind](pattern, term)));
  const entries: PaletteEntry[] = [];
  const failed: string[] = [];
  settled.forEach((s, i) => {
    const kind = kinds[i]!;
    if (s.status === "fulfilled") entries.push(...s.value.map((hit) => recordEntry(kind, hit)));
    else failed.push(`${kind.noun}s`);
  });
  return { entries, failed };
}

/** Debounced record search for the palette's query, over the kinds `entries` and the guard allow. */
export function useRecordSearch(query: Ref<string>, entries: Ref<PaletteEntry[]>) {
  const opens = useOpens();
  const kinds = computed(() => searchableKinds(entries.value, opens));
  const debounced = refDebounced(query, 200);
  const term = computed(() => recordSearchTerm(debounced.value));
  const typedTerm = computed(() => recordSearchTerm(query.value));
  const kindKey = computed(() => kinds.value.map((k) => k.kind).join(","));

  const search = useQuery({
    queryKey: computed(() => ["record-search", kindKey.value, term.value] as const),
    enabled: computed(() => term.value !== null && kinds.value.length > 0),
    queryFn: () => runRecordSearch(term.value!, kinds.value),
    staleTime: 30_000,
    retry: false,
  });

  // An answer is shown only for what is typed NOW: a result list for "104" left under "1042" while the
  // new read runs would offer a row the new term does not match.
  const current = computed(() => (term.value !== null && term.value === typedTerm.value ? search.data.value : undefined));

  return {
    kinds,
    records: computed(() => current.value?.entries ?? []),
    failed: computed(() => current.value?.failed ?? []),
    /** True from the keystroke until the answer for what is typed NOW has arrived. */
    searching: computed(
      () => kinds.value.length > 0 && typedTerm.value !== null && (typedTerm.value !== term.value || search.isFetching.value),
    ),
  };
}
