import { Router, json } from "express";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import {
  tmsMovementsPayloadSchema,
  driverTimeOffPayloadSchema,
  tmsLoadsPayloadSchema,
  tmsDriversPayloadSchema,
  tmsVehiclesPayloadSchema,
  tmsTrailersPayloadSchema,
  tmsRetirePayloadSchema,
} from "@fuelguard/shared";
import { orgForIngestToken, ingestMovements, ingestDriverTimeOff, touchLastSynced } from "../services/tmsIngest.js";
import { ingestLoads } from "../services/tmsLoadIngest.js";
import { ingestDrivers, ingestVehicles, ingestTrailers } from "../tms/rosterIngest.js";
import { retireFromTms } from "../tms/rosterRetire.js";

/**
 * Inbound TMS ingest from the on-prem sync agent. NO user auth — authenticated by the org's ingest token
 * (`Authorization: Bearer <token>`), matched by HASH to an ENABLED org_integrations row. Mounted with its own
 * body parser (larger limit, for ≤1000-row batches) BEFORE the global 1 MB JSON parser so batches aren't
 * rejected and the browser API's parsing rules don't apply here.
 */
export function tmsIngestRouter(): Router {
  const router = Router();
  router.use(json({ limit: "8mb" }));

  // Authenticate every request by ingest token → org. One generic 401 (no token vs bad token are
  // indistinguishable) so the endpoint leaks nothing about which tokens exist.
  router.use(
    asyncHandler(async (req, res, next) => {
      const header = req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      // Reject a missing token up front — no DB/client work for the unauthenticated path.
      if (!token) {
        res.status(401).json(apiError("unauthorized", "Invalid ingest token"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const owner = await orgForIngestToken(admin, token);
      if (!owner) {
        res.status(401).json(apiError("unauthorized", "Invalid ingest token"));
        return;
      }
      req.tms = owner;
      next();
    }),
  );

  // ── roster (M3, link-only) ────────────────────────────────────────────────────────────────────
  //
  // Three endpoints rather than one, because the three payloads have different shapes and a partial
  // failure should strand one entity, not all of them. Each is idempotent on the TMS's own id, so the
  // agent can re-send a sweep safely — which is what makes the hash-based change detection on its side
  // an optimisation rather than a correctness requirement.
  for (const [path, schema, key, run] of [
    ["/roster/drivers", tmsDriversPayloadSchema, "drivers", ingestDrivers],
    ["/roster/vehicles", tmsVehiclesPayloadSchema, "vehicles", ingestVehicles],
    ["/roster/trailers", tmsTrailersPayloadSchema, "trailers", ingestTrailers],
  ] as const) {
    router.post(
      path,
      asyncHandler(async (req, res) => {
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json(apiError("invalid_payload", parsed.error.issues[0]?.message ?? "invalid payload"));
          return;
        }
        const { orgId, provider } = req.tms!;
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const rows = (parsed.data as Record<string, unknown>)[key] as never;
        // The agent declares which mode it is running in. Link is the default and the safe one: a
        // misconfigured agent that forgets the parameter refreshes nothing, rather than writing
        // identity onto a roster nobody has reviewed the match for yet.
        const mode =
          req.query.mode === "create" ? "create" : req.query.mode === "identity" ? "identity" : "link";
        const result = await run(admin, orgId, rows, mode);
        await touchLastSynced(admin, orgId, provider);
        res.json(result);
      }),
    );
  }

  // Retirement is its own endpoint, not a mode on the sweeps above. It is the one operation that takes
  // capability away from a person and the only one that touches the retention clock, so it happens when
  // an operator asks for it rather than riding along with a routine identity refresh.
  for (const entity of ["drivers", "vehicles", "trailers"] as const) {
    router.post(
      `/roster/${entity}/retire`,
      asyncHandler(async (req, res) => {
        const parsed = tmsRetirePayloadSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json(apiError("invalid_payload", parsed.error.issues[0]?.message ?? "invalid payload"));
          return;
        }
        const { orgId, provider } = req.tms!;
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const result = await retireFromTms(admin, orgId, entity, parsed.data.retire);
        await touchLastSynced(admin, orgId, provider);
        res.json(result);
      }),
    );
  }

  router.post(
    "/movements",
    asyncHandler(async (req, res) => {
      const parsed = tmsMovementsPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "invalid payload"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { orgId, provider } = req.tms!;
      const result = await ingestMovements(admin, orgId, provider, parsed.data.movements);
      await touchLastSynced(admin, orgId, provider);
      res.json({ ok: true, ...result });
    }),
  );

  router.post(
    "/driver-time",
    asyncHandler(async (req, res) => {
      const parsed = driverTimeOffPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "invalid payload"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { orgId, provider } = req.tms!;
      const result = await ingestDriverTimeOff(admin, orgId, provider, parsed.data.windows);
      await touchLastSynced(admin, orgId, provider);
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * Dispatchable loads (Phase 3E, D48). Distinct from /movements, which only carries reefer context:
   * these become rows a driver actually works — and they land in `pending_approval`, so the feed can
   * never put work on a phone that no human has released.
   */
  router.post(
    "/loads",
    asyncHandler(async (req, res) => {
      const parsed = tmsLoadsPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "invalid payload"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { orgId, provider } = req.tms!;
      const result = await ingestLoads(admin, orgId, provider, parsed.data.loads);
      await touchLastSynced(admin, orgId, provider);
      res.json({ ok: true, ...result });
    }),
  );

  return router;
}
