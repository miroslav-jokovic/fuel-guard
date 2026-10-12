import { computed, type Ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import type { HazmatCalcRequest, HazmatCalcResponse, HazmatProduct, HazmatProductsResponse } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import type { CalcResult } from "./calcModel";

/**
 * HazmatGuard manual placard calculator composables (plan H5). The pure form model + form→request logic
 * lives in ./calcModel (unit-tested without the browser client); this file adds the Vue Query wiring.
 * Stateless — every calculation is one `POST /api/hazmat/calc`; products resolve through
 * `GET /api/hazmat/products` because the web app can't import @hazmat/data.
 */
export * from "./calcModel";

/** HMT product lookup for the picker. Blank query → curated fuel shortlist; else full-HMT search. */
export function useHazmatProductsQuery(q: Ref<string>, basePath = "/api/hazmat") {
  return useQuery({
    queryKey: computed(() => ["hazmat", "products", basePath, q.value.trim()] as const),
    queryFn: async (): Promise<HazmatProduct[]> => {
      const search = q.value.trim();
      const path = search ? `${basePath}/products?q=${encodeURIComponent(search)}` : `${basePath}/products`;
      const res = await apiFetch<HazmatProductsResponse>(path);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Product lookup failed");
      return res.data.products;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Exactly the products these `hmtRef`s name (`GET /products?refs=`) — the BOL reader's prefill holds the
 * table's own ref for each read line and needs its product, never a search (§7A N6). A ref the dataset
 * does not hold is simply absent from the answer.
 */
export async function fetchProductsByRef(refs: readonly string[], basePath = "/api/hazmat"): Promise<HazmatProduct[]> {
  if (refs.length === 0) return [];
  const res = await apiFetch<HazmatProductsResponse>(`${basePath}/products?refs=${encodeURIComponent(refs.join(","))}`);
  if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Product lookup failed");
  return res.data.products;
}

/** Run the calculator. Returns the typed verdict (the API types `verdict` as unknown at the boundary). */
export function useHazmatCalc(basePath = "/api/hazmat") {
  return useMutation({
    mutationFn: async (req: HazmatCalcRequest): Promise<CalcResult> => {
      const res = await apiFetch<HazmatCalcResponse>(`${basePath}/calc`, { method: "POST", body: req });
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Calculation failed");
      return { ...res.data, verdict: res.data.verdict as CalcResult["verdict"] };
    },
  });
}
