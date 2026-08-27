import type { Router } from "express";
import { requireOrg } from "../../../middleware/auth.js";
import { dbErrorResponse, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { resolveEffectivePrice, median, DEFAULT_PRICE_LOOKBACK_HOURS, type DiscountRule } from "@silvicom/shared";

/** The Truck Stops listing: every registry station in the org's enabled networks, each with the diesel
 *  price planning would actually use (fresh tenant net → posted−rule → history → brand median → none) and
 *  its staleness vs the org price-freshness window. Read-only. */
export function registerStationRoutes(router: Router): void {
  router.get(
    "/stations",
    requireOrg,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const { data: settingsRow } = await admin
        .from("route_fuel_settings").select("price_ttl_hours, enabled_brands").eq("org_id", orgId).maybeSingle();
      const ttlHours = settingsRow?.price_ttl_hours != null ? Number(settingsRow.price_ttl_hours) : 72;
      const enabledBrands: string[] =
        Array.isArray(settingsRow?.enabled_brands) && settingsRow.enabled_brands.length
          ? (settingsRow.enabled_brands as string[])
          : ["pilot", "flying_j", "one9"];

      const now = Date.now();
      const lookbackHours = DEFAULT_PRICE_LOOKBACK_HOURS;
      const cutoffMs = now - lookbackHours * 3_600_000;
      const SAMPLE_CAP = 40; // recent samples kept per station for the estimate (bounds memory)

      // Latest diesel price per station + a bounded recent-history window for estimating stale/missing prices.
      //
      // Read through `fuel_prices_for_planning` (0245) rather than by paging the table. Until prices were
      // KEPT this was a single page, because the table held one day; three months of daily reports make it
      // roughly forty, on every load of this page. The function caps samples PER STATION and still returns
      // each station's most recent row however old it is, so the cost stops growing with history while the
      // rows this loop sees are exactly the ones it saw before.
      const latest = new Map<string, { net: number | null; posted: number | null; at: string }>();
      const samples = new Map<string, { net: number | null; observedAtMs: number }[]>();
      const PAGE = 5000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .rpc("fuel_prices_for_planning", {
            p_org: orgId,
            p_since: new Date(cutoffMs).toISOString(),
            p_cap: SAMPLE_CAP,
            p_product: "diesel",
          })
          .range(from, from + PAGE - 1);
        if (error) { dbErrorResponse(res, "fuel_prices read", error, "Could not load fuel prices"); return; }
        const rows = (data ?? []) as Array<{ station_id: string; net_price: number | string | null; posted_price: number | string | null; observed_at: string }>;
        for (const p of rows) {
          const net = p.net_price != null ? Number(p.net_price) : null;
          const atMs = Date.parse(p.observed_at);
          // Rows arrive station-major, newest first, so the first row for a station IS its latest.
          if (!latest.has(p.station_id)) latest.set(p.station_id, { net, posted: p.posted_price != null ? Number(p.posted_price) : null, at: p.observed_at });
          if (atMs >= cutoffMs) {
            const arr = samples.get(p.station_id) ?? samples.set(p.station_id, []).get(p.station_id)!;
            if (arr.length < SAMPLE_CAP) arr.push({ net, observedAtMs: atMs });
          }
        }
        if (rows.length < PAGE) break;
      }

      // The full registry for the enabled networks (not just tenant-priced stations — a station with
      // only a posted price must appear, with its effective planning price).
      type StMeta = { id: string; brand: string; store_number: string | null; name: string | null; state: string | null; city: string | null; lat: number | string; lng: number | string; exit: string | null; coord_source: string | null };
      const meta = new Map<string, StMeta>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("fuel_stations")
          .select("id, brand, store_number, name, state, city, lat, lng, exit, coord_source")
          .eq("status", "active").in("brand", enabledBrands)
          .range(from, from + PAGE - 1);
        if (error) { dbErrorResponse(res, "fuel_stations read", error, "Could not load fuel stations"); return; }
        for (const st of (data ?? []) as StMeta[]) meta.set(st.id, st);
        if (!data || data.length < PAGE) break;
      }

      // Latest posted diesel quote per station (global layer) within the lookback.
      const posted = new Map<string, { price: number; currency: string; unit: string; at: string }>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("fuel_prices_posted").select("station_id, price, currency, unit, observed_at")
          .eq("product", "diesel").gte("observed_at", new Date(cutoffMs).toISOString())
          .order("observed_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) { dbErrorResponse(res, "fuel_prices_posted read", error, "Could not load posted prices"); return; }
        for (const p of (data ?? []) as Array<{ station_id: string; price: number | string; currency: string; unit: string; observed_at: string }>) {
          if (!posted.has(p.station_id)) posted.set(p.station_id, { price: Number(p.price), currency: p.currency, unit: p.unit, at: p.observed_at });
        }
        if (!data || data.length < PAGE) break;
      }

      const { data: ruleRows } = await admin.from("fuel_discount_rules").select("brand, type, cents_off").eq("org_id", orgId);
      const ruleByBrand = new Map<string, DiscountRule>(
        ((ruleRows ?? []) as Array<{ brand: string; type: DiscountRule["type"]; cents_off: number | string }>).map((r) => [
          r.brand, { brand: r.brand, type: r.type, centsOff: Number(r.cents_off) },
        ]),
      );

      // Brand medians (fresh tenant quotes only) — the fallback when a station has no usable history.
      const freshByBrand = new Map<string, number[]>();
      for (const [id, pr] of latest) {
        const m = meta.get(id);
        if (m && pr.net != null && (now - Date.parse(pr.at)) / 3_600_000 <= ttlHours)
          (freshByBrand.get(m.brand) ?? freshByBrand.set(m.brand, []).get(m.brand)!).push(pr.net);
      }

      const stations: Record<string, unknown>[] = [];
      for (const [id, st] of meta) {
        const pr = latest.get(id) ?? null;
        const po = posted.get(id) ?? null;
        const est = resolveEffectivePrice({
          tenantSamples: samples.get(id) ?? [],
          posted: po ? { price: po.price, currency: po.currency, unit: po.unit, observedAtMs: Date.parse(po.at) } : null,
          discountRule: ruleByBrand.get(st.brand) ?? null,
          brandMedian: median(freshByBrand.get(st.brand) ?? []),
          nowMs: now, ttlHours, lookbackHours,
        });
        // Freshness reflects the quote the effective price is actually based on.
        const basisAt = est.basis === "posted_discount" ? (po?.at ?? null) : (pr?.at ?? null);
        const ageHours = basisAt != null ? Math.round((now - Date.parse(basisAt)) / 3_600_000) : null;
        stations.push({
          id, brand: st.brand, storeNumber: st.store_number, name: st.name, state: st.state, city: st.city,
          lat: Number(st.lat), lng: Number(st.lng), exit: st.exit, coordSource: st.coord_source ?? "geocoded_city",
          netPrice: est.net, priceEstimated: est.estimated, priceConfidence: est.estimated ? est.confidence : null,
          priceBasis: est.basis,
          // Prefer the global posted layer (USD/gal); until that's populated (waiting on chain feeds),
          // fall back to the retail price the daily email already carries so the column isn't blank.
          postedPrice:
            po && po.currency === "USD" && po.unit === "gal"
              ? po.price
              : (pr?.posted ?? null),
          observedAt: basisAt, ageHours, stale: ageHours != null && ageHours > ttlHours,
        });
      }
      stations.sort((a, b) => String(a.state).localeCompare(String(b.state)) || String(a.name).localeCompare(String(b.name)));
      res.json({ stations, ttlHours });
    }),
  );
}
