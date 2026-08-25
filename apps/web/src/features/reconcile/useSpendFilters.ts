/**
 * The filters every view on the fuel-spend page shares, held in the URL.
 *
 * ── WHY ONE OWNER AND NOT ONE PER TAB ────────────────────────────────────────────────────────────
 * Each tab used to carry its own idea of the period — the trend tab a rolling window of weeks, the
 * statement tabs a statement picker — so moving between them silently changed which days you were
 * looking at. A figure quoted off one tab and checked against another would disagree for a reason
 * neither screen showed. One set of filters, read by every tab and by the export.
 *
 * ── WHY THE URL ──────────────────────────────────────────────────────────────────────────────────
 * This page exists to be sent to somebody. State that dies on refresh cannot be linked, and a
 * screenshot of a filtered view is unreproducible by the person receiving it. Everything that changes
 * what the numbers mean — dates, trucks, grain, tab — is a query parameter.
 */
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { SpendGrain } from "@fuelguard/shared";

/** Default span: long enough to show a seasonal move and to support a trailing comparison at both ends. */
export const DEFAULT_DAYS = 90;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const shiftDays = (n: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
};

const one = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s !== "" ? s : undefined;
};
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface SpendFilters {
  from: string;
  to: string;
  /** Vehicle ids to narrow to. Empty means the whole fleet — NOT "no trucks". */
  vehicleIds: string[];
  grain: SpendGrain;
  active: boolean;
}

export function useSpendFilters() {
  const route = useRoute();
  const router = useRouter();

  // `replace` throughout: adjusting a filter is not a navigation, and a reader pressing back expects to
  // leave the page rather than walk their own filter history.
  const set = (patch: Record<string, string | undefined>) =>
    void router.replace({ query: { ...route.query, ...patch } });

  const from = computed<string>({
    get: () => {
      const v = one(route.query.from);
      return v && YMD.test(v) ? v : shiftDays(-DEFAULT_DAYS);
    },
    set: (v) => set({ from: v || undefined }),
  });
  const to = computed<string>({
    get: () => {
      const v = one(route.query.to);
      return v && YMD.test(v) ? v : ymd(new Date());
    },
    set: (v) => set({ to: v || undefined }),
  });
  const vehicleIds = computed<string[]>({
    get: () => (one(route.query.trucks) ?? "").split(",").filter(Boolean),
    set: (v) => set({ trucks: v.length ? v.join(",") : undefined }),
  });
  const grain = computed<SpendGrain>({
    get: () => {
      const v = one(route.query.grain);
      return v === "day" || v === "month" ? v : "week";
    },
    set: (v) => set({ grain: v }),
  });
  const tab = computed<string>({
    get: () => one(route.query.tab) ?? "",
    set: (v) => set({ tab: v }),
  });

  /** True when the reader has narrowed anything — used to say so on the export and in empty states. */
  const active = computed(
    () => one(route.query.from) != null || one(route.query.to) != null || vehicleIds.value.length > 0,
  );

  const range = computed(() => ({ from: from.value, to: to.value }));
  /** Everything the server needs to reproduce this view, as query-string pairs. */
  const asQuery = computed(() => {
    const q = new URLSearchParams({ from: from.value, to: to.value, grain: grain.value });
    if (vehicleIds.value.length) q.set("vehicles", vehicleIds.value.join(","));
    return q.toString();
  });

  function reset(): void {
    set({ from: undefined, to: undefined, trucks: undefined });
  }

  return { from, to, vehicleIds, grain, tab, range, active, asQuery, reset };
}
