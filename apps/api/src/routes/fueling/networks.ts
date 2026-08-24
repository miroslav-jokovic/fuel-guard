import type { Router } from "express";
import { requireRole, requireOrg } from "../../middleware/auth.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { ingestPilotPrices } from "../../services/pilotPriceIngest.js";
import { ingestPilotLocations } from "../../services/pilotLocationsIngest.js";
import { ingestPostedPrices } from "../../services/postedPriceIngest.js";
import { gatePostedBatch, runPostedPriceFetch, POSTED_SOURCE_XLSX } from "../../services/postedPriceFetch.js";
import { runKwikTripSync } from "../../services/kwikTripIngest.js";
import { runRoadRangerFetch } from "../../services/roadRangerIngest.js";
import { ingestLovesExport } from "../../services/lovesIngest.js";
import { runLovesApiSync } from "../../services/lovesApiClient.js";
import { parsePilotPublicPricesXlsx, type StatementWord } from "@fuelguard/shared";
import { ingestFuelStatement, STATEMENT_BUCKET } from "../../services/fuelStatementIngest.js";

/** Add a truck-stop network to the org's enabled_brands so freshly loaded/synced stations show up on the
 *  Truck Stops page (and its network filter) immediately, instead of staying hidden until an admin toggles
 *  it on in Fuel Planning settings. Idempotent — a no-op when the brand is already enabled. */
async function enableNetworkForOrg(admin: ReturnType<typeof getSupabaseAdmin>, orgId: string, brand: string): Promise<void> {
  const { data } = await admin.from("route_fuel_settings").select("enabled_brands").eq("org_id", orgId).maybeSingle();
  const current =
    Array.isArray(data?.enabled_brands) && data.enabled_brands.length
      ? (data.enabled_brands as string[])
      : ["pilot", "flying_j", "one9"];
  if (current.includes(brand)) return;
  await admin
    .from("route_fuel_settings")
    .upsert({ org_id: orgId, enabled_brands: [...current, brand], updated_at: new Date().toISOString() }, { onConflict: "org_id" });
}

/** Price-report + truck-stop network ingestion routes (Pilot family, posted prices, Kwik Trip, Road Ranger, Love's). */
export function registerNetworkRoutes(router: Router): void {
  // Load a Pilot daily price report (client decodes the .xls to a cell grid; we parse + geocode + upsert).
  router.post(
    "/prices",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const grid = (req.body as { grid?: unknown[] })?.grid;
      if (!Array.isArray(grid)) {
        res.status(400).json(apiError("bad_request", "Expected { grid: Cell[][] } from the decoded report."));
        return;
      }
      const result = await ingestPilotPrices(admin, env, req.auth!.orgId!, grid as (string | number | null)[][]);
      if (!result.ok) {
        res.status(422).json(apiError("ingest_failed", result.error ?? "Could not ingest the report"));
        return;
      }
      res.json(result);
    }),
  );

  // Record a weekly Pilot direct-bill statement. The browser decodes the PDF (only it has pdfjs) and
  // sends the positioned WORDS plus the original bytes; the server re-parses and refuses anything that
  // does not reproduce the statement's own printed totals, so a browser can never assert a statement.
  router.post(
    "/statements",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const body = req.body as { words?: unknown; filename?: unknown; sourceBase64?: unknown };
      if (!Array.isArray(body?.words) || body.words.length === 0) {
        res.status(400).json(apiError("bad_request", "Expected { words: StatementWord[] } from the decoded PDF."));
        return;
      }
      const result = await ingestFuelStatement(admin, req.auth!.orgId!, req.auth!.userId, {
        words: body.words as StatementWord[],
        filename: typeof body.filename === "string" ? body.filename : null,
        sourceBase64: typeof body.sourceBase64 === "string" ? body.sourceBase64 : null,
      });
      if (!result.ok) {
        // The tie-out failures travel with the error on purpose: "the statement didn't add up" is
        // useless to the person holding the PDF, "fuel total $x vs the printed $y" is actionable.
        res.status(422).json({
          ...apiError("statement_rejected", result.error ?? "Could not record the statement"),
          tieOutFailures: result.tieOutFailures ?? [],
        });
        return;
      }
      res.json(result);
    }),
  );

  // The original PDF behind a statement. Served as a short-lived signed URL rather than a public
  // object: the bucket has no client policies at all, so this route is the only door, and it re-checks
  // the caller's org before issuing one — the service role bypasses RLS.
  router.get(
    "/statements/:id/source",
    requireOrg,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const { data } = await admin
        .from("fuel_statements")
        .select("source_path")
        .eq("org_id", req.auth!.orgId!)
        .eq("id", req.params.id)
        .maybeSingle();
      const path = (data as { source_path: string | null } | null)?.source_path;
      if (!path) {
        res.status(404).json(apiError("not_found", "No source document was stored for that statement."));
        return;
      }
      const signed = await admin.storage.from(STATEMENT_BUCKET).createSignedUrl(path, 300);
      if (signed.error || !signed.data?.signedUrl) {
        res.status(502).json(apiError("storage_unavailable", "Could not open the stored statement."));
        return;
      }
      res.json({ url: signed.data.signedUrl });
    }),
  );

  // Load the Pilot "Download All Locations" export (exact coordinates for the whole family) into the
  // GLOBAL station registry. Admin-only: it rewrites shared reference data (brands, precise coords).
  router.post(
    "/locations",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const grid = (req.body as { grid?: unknown[] })?.grid;
      if (!Array.isArray(grid)) {
        res.status(400).json(apiError("bad_request", "Expected { grid: Cell[][] } from the decoded export."));
        return;
      }
      const result = await ingestPilotLocations(admin, grid as (string | number | null)[][]);
      if (!result.ok) {
        res.status(422).json(apiError("ingest_failed", result.error ?? "Could not ingest the locations export"));
        return;
      }
      res.json(result);
    }),
  );

  // Load the public "Download Fuel Prices" .xlsx (network-wide POSTED prices — the global layer).
  // Gated exactly like the automated page fetch: completeness floor + diesel-median sanity band.
  router.post(
    "/posted-prices",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const grid = (req.body as { grid?: unknown[] })?.grid;
      if (!Array.isArray(grid)) {
        res.status(400).json(apiError("bad_request", "Expected { grid: Cell[][] } from the decoded file."));
        return;
      }
      const parsed = parsePilotPublicPricesXlsx(grid as (string | number | null)[][]);
      if (!parsed.headerFound) {
        res.status(422).json(apiError("ingest_failed", "Unrecognized file — expected the public 'Download Fuel Prices' export."));
        return;
      }
      const dieselUsd = parsed.rows.filter((r) => r.product === "diesel" && r.currency === "USD").map((r) => r.price);
      const gateError = gatePostedBatch(parsed.stationRows, dieselUsd, 700);
      if (gateError) {
        res.status(422).json(apiError("ingest_failed", gateError));
        return;
      }
      const result = await ingestPostedPrices(admin, parsed.rows, {
        source: POSTED_SOURCE_XLSX, observedAt: new Date().toISOString(),
        stationRows: parsed.stationRows, skipped: parsed.skipped,
      });
      if (!result.ok) {
        res.status(422).json(apiError("ingest_failed", result.error ?? "Could not ingest the posted prices"));
        return;
      }
      res.json(result);
    }),
  );

  // Manually trigger the automated posted-price page fetch (same gates as the scheduler) — lets an
  // admin refresh now and SEE the result instead of waiting for the next tick.
  router.post(
    "/posted-prices/fetch",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await runPostedPriceFetch(admin, env);
      if (!result.ok) {
        res.status(422).json(apiError("fetch_failed", result.error ?? "Posted-price fetch failed"));
        return;
      }
      res.json(result);
    }),
  );

  // Sync the Kwik Trip / Kwik Star network into the registry (official truck-friendly stores only —
  // parse + completeness gates refuse a partial table). Admin-only; safe to re-run any time.
  router.post(
    "/networks/kwiktrip/sync",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await runKwikTripSync(admin, env);
      if (!result.ok) {
        res.status(422).json(apiError("sync_failed", result.error ?? "Kwik Trip sync failed"));
        return;
      }
      await enableNetworkForOrg(admin, req.auth!.orgId!, "kwik_trip");
      res.json(result);
    }),
  );

  // Fetch Road Ranger stations + today's truck-diesel CASH prices now (same gates as the scheduler).
  router.post(
    "/networks/roadranger/fetch",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await runRoadRangerFetch(admin, env);
      if (!result.ok) {
        res.status(422).json(apiError("fetch_failed", result.error ?? "Road Ranger fetch failed"));
        return;
      }
      await enableNetworkForOrg(admin, req.auth!.orgId!, "road_ranger");
      res.json(result);
    }),
  );

  // Load the Love's "Search Results" .xlsx export — the whole network's exact locations + current posted
  // diesel/DEF prices in one file. Admin-only; Love's has its own store-number space (never the Pilot family).
  router.post(
    "/networks/loves/import",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const grid = (req.body as { grid?: unknown[] })?.grid;
      if (!Array.isArray(grid)) {
        res.status(400).json(apiError("bad_request", "Expected { grid: Cell[][] } from the decoded file."));
        return;
      }
      const result = await ingestLovesExport(admin, grid as (string | number | null)[][]);
      if (!result.ok) {
        res.status(422).json(apiError("ingest_failed", result.error ?? "Could not ingest the Love's export"));
        return;
      }
      await enableNetworkForOrg(admin, req.auth!.orgId!, "loves");
      res.json(result);
    }),
  );

  // Live Love's Store & Fuel Prices API sync (OAuth). Returns a clear "not configured" message until
  // credentials + product codes are set, so it is safe to wire a button now.
  router.post(
    "/networks/loves/sync",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await runLovesApiSync(admin, env);
      if (!result.ok) {
        res.status(422).json(apiError("sync_failed", result.error ?? "Love's API sync failed"));
        return;
      }
      await enableNetworkForOrg(admin, req.auth!.orgId!, "loves");
      res.json(result);
    }),
  );
}
