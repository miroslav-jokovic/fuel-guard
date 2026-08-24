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
import { isTmsRosterMaster } from "../tms/rosterMastery.js";
import type { RosterMode } from "../tms/rosterIngest.js";

/** The modes this build understands, safest first. Anything else is refused — see the route below. */
const ROSTER_MODES = ["report", "link", "identity", "create"] as const;

/**
 * Writing identity, creating rows and retiring them are all claims on WHO OWNS THE ROSTER, and that
 * question has exactly one answer per org: `org_integrations.config.roster_master`.
 *
 * Until this gate existed the answer was recorded in two places that could disagree. The Samsara
 * syncs read the flag and stand off when it is set; the mode above came from a QUERY PARAMETER the
 * on-prem agent chose for itself. An agent configured with ROSTER_MODE=identity against an org that
 * had never declared mastery would have both systems writing the same columns — McLeod writing 175
 * tractor plates and the Samsara sync nulling them on its next tick, with nothing raising. A client
 * on the carrier's network cannot be the one to decide a data-ownership question.
 *
 * `link` mode is deliberately NOT gated. It writes only the external link and reports what it could
 * not place, which is exactly the measurement an operator runs BEFORE deciding whether to hand the
 * roster over — gating it would make the decision impossible to inform.
 */
async function refuseUnlessRosterMaster(
  admin: ReturnType<typeof getSupabaseAdmin>,
  orgId: string,
  res: Parameters<Parameters<typeof asyncHandler>[0]>[1],
): Promise<boolean> {
  if (await isTmsRosterMaster(admin, orgId)) return false;
  res
    .status(409)
    .json(
      apiError(
        "roster_master_not_declared",
        "This org has not declared its TMS as the roster master, so the TMS may not write identity, create rows or retire them. Run the sweep in link mode, review the match report, then declare mastery.",
      ),
    );
  return true;
}

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
        // ── AN UNRECOGNISED MODE IS A REFUSAL, NOT A DOWNGRADE ──────────────────────────────────
        //
        // This chain used to end in `: "link"`, which meant ANY unknown value wrote links. That is a
        // silent version-skew trap and it very nearly fired: `report` shipped in the agent before the
        // API that understands it was deployed, so `?mode=report` against the older build would have
        // fallen through and written `mcleod_*_id` onto ~589 production rows — from the one command
        // whose entire promise is that it writes nothing.
        //
        // A caller that names a mode this build does not know is a caller from a different version,
        // and guessing what it meant is how the guess becomes a write. It fails loudly instead.
        //
        // The ABSENT default is `report`, not `link`: a parameter nobody sent is a misconfiguration,
        // and the safe reading of a misconfiguration is "do nothing and let somebody notice".
        const raw = req.query.mode;
        const mode: RosterMode | undefined =
          raw === undefined ? "report" : ROSTER_MODES.find((m) => m === raw);
        if (!mode) {
          res
            .status(400)
            .json(apiError("unknown_mode", `mode must be one of ${ROSTER_MODES.join(", ")} — got "${String(raw)}"`));
          return;
        }
        // `report` and `link` are ungated. Report writes nothing at all, and link writes only the
        // external link — together they ARE the measurement the mastery decision is made from, so
        // gating them would make that decision impossible to inform.
        if (mode !== "link" && mode !== "report" && (await refuseUnlessRosterMaster(admin, orgId, res))) return;
        const result = await run(admin, orgId, rows, mode);
        // A REPORT is not a sync. `last_synced_at` drives the "as of HH:MM" freshness the operator
        // reads (D-MR2), and a rehearsal that deliberately moved no data must not claim the roster
        // was just refreshed — that would make the one indicator of staleness lie in the direction
        // nobody checks.
        if (mode !== "report") await touchLastSynced(admin, orgId, provider);
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
        // Retirement is the strongest claim of the three — it takes capability away from a person and
        // starts the §391.51 retention clock — so it needs the declaration at least as much as the
        // identity sweep does. Without mastery the Samsara deactivation pass is still running, and two
        // systems retiring the same rows is the fight D-MR5 exists to prevent.
        if (await refuseUnlessRosterMaster(admin, orgId, res)) return;
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
