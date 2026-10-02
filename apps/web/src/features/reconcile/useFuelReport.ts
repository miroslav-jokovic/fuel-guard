/**
 * The Fuel Costs report (FS2) — one server read for the whole page, `GET /api/fueling/report`.
 *
 * The page used to assemble itself in the browser from four sources (spend lines, the rollup days, the
 * statements, the fill sequence), each with its own 1,000-row ceiling to page around. Now SQL sums,
 * shared code makes the ratios, the API composes the MPG beside them, and this file only asks.
 */
import { computed, type Ref } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { defaultWindow, FUEL_NETWORKS, type FuelNetwork, type FuelReport } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useQueryState } from "@/composables/useQueryState";
import { useSpendFilters } from "./useSpendFilters";

export interface FuelReportParams {
  from: string;
  to: string;
  vehicleIds: string[];
  states: string[];
  siteIds: string[];
  networks: FuelNetwork[];
}

/** The query string the API reads — and the one the page's link carries, so a forwarded view reproduces. */
export function fuelReportQuery(p: FuelReportParams): string {
  const q = new URLSearchParams({ from: p.from, to: p.to });
  if (p.vehicleIds.length) q.set("vehicles", p.vehicleIds.join(","));
  if (p.states.length) q.set("states", p.states.join(","));
  if (p.siteIds.length) q.set("sites", p.siteIds.join(","));
  if (p.networks.length) q.set("networks", p.networks.join(","));
  return q.toString();
}

export function useFuelReportQuery(params: Ref<FuelReportParams>) {
  return useQuery({
    queryKey: ["fuel_report", params],
    staleTime: 60_000,
    // A filter change keeps the old figures on screen until the new ones land, rather than blanking
    // the page between two clicks.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<FuelReport> => {
      const res = await apiFetch<FuelReport>(`/api/fueling/report?${fuelReportQuery(params.value)}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the fuel report");
      return res.data;
    },
  });
}

/**
 * The page's filters, in the URL: `useSpendFilters`' window and trucks (one vocabulary for both with
 * the Findings inbox), plus the three station-side filters only this report has (D-FSV1).
 */
export function useFuelCostFilters() {
  const base = useSpendFilters();
  const { list, set } = useQueryState();

  const listParam = (key: string) =>
    computed<string[]>({
      get: () => list(key),
      set: (v) => set({ [key]: v.length ? v.join(",") : undefined }),
    });
  const states = listParam("states");
  const siteIds = listParam("sites");
  const networksRaw = listParam("networks");
  // A hand-edited `?networks=pilot` would be refused by the API with a 400; drop it here instead, the
  // same courtesy `normalizeWindow` gives a backwards date.
  const networks = computed<FuelNetwork[]>({
    get: () => networksRaw.value.filter((n): n is FuelNetwork => (FUEL_NETWORKS as readonly string[]).includes(n)),
    set: (v) => { networksRaw.value = v; },
  });

  /** True under a filter that selects FILLS rather than trucks — the API then has no truck figures. */
  const stationFiltered = computed(() => states.value.length + siteIds.value.length + networks.value.length > 0);
  /**
   * Not `useSpendFilters.active`: that one also lights up for a non-default `?grain=`, which this page
   * no longer offers, so an old link carrying one would show a "Clear filters" that clears nothing seen.
   */
  const active = computed(() => {
    if (stationFiltered.value || base.vehicleIds.value.length > 0) return true;
    const d = defaultWindow(new Date().toISOString().slice(0, 10));
    return base.from.value !== d.from || base.to.value !== d.to;
  });

  const params = computed<FuelReportParams>(() => ({
    from: base.from.value,
    to: base.to.value,
    vehicleIds: base.vehicleIds.value,
    states: states.value,
    siteIds: siteIds.value,
    networks: networks.value,
  }));

  function reset(): void {
    set({ from: undefined, to: undefined, trucks: undefined, grain: undefined, states: undefined, sites: undefined, networks: undefined });
  }

  return { ...base, states, siteIds, networks, stationFiltered, active, params, reset };
}
