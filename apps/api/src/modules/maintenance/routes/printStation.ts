import { json, Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import {
  stationHelloSchema,
  stationPairSchema,
  stationReportSchema,
  stationScanSchema,
  type StationHello,
  type StationPairRequest,
  type StationReport,
  type StationScanRequest,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { isServiceError } from "../inventory/types.js";
import { pairStation, stationForToken, stationHello, type StationRow } from "../printing/stations.js";
import { claimNextJob, finishJob } from "../printing/jobs.js";
import { recordRead, recordStationPorts, scannersForStation } from "../printing/scannerStation.js";

/**
 * `/api/print-station` — the print station program's API (PRINTERS-AND-SCANNERS-PLAN.md PS2/PS3).
 *
 * NO user session: a station is a machine, authenticated by its bearer token, matched by HASH to a
 * live `print_stations` row (stations.ts) — the McLeod connector's model (`tmsIngest.ts`). One
 * generic 401 for a missing, wrong or revoked token, so the endpoint says nothing about which tokens
 * exist. The single exception is `POST /pair`, where the pairing code in the body is the credential.
 *
 * ── MOUNTED AHEAD OF THE BROWSER API, WITH ITS OWN BUDGET ────────────────────────────────────
 * `app.ts` mounts this before the general per-address limits and the 1 MB parser, for the TMS
 * agent's reasons: not a browser, its own small parser, and its own budget — so an office PC
 * long-polling for labels never spends the office's shared per-address allowance. 300 per 15 minutes
 * (the TMS agent's number) covers an idle station ~6× over (a 25 s poll and a hello a minute) with
 * room for a busy tagging run (a claim and a report per job), and is still a wall for anybody
 * guessing an eight-character pairing code.
 *
 * ── THE LONG POLL ────────────────────────────────────────────────────────────────────────────
 * `GET /jobs/next` waits up to `LONG_POLL_MS` for a job and answers 204 if none came. The station
 * calls it again at once, so a label pressed on a phone starts printing within about a second, while
 * an idle station costs one request every 25 seconds instead of one a second — and needs nothing
 * opened on the office's firewall, because the station always dials out. The wait asks the database
 * once a second (0526's claim, which is also the heartbeat); it ends early if the station hangs up.
 *
 * ── SCANNERS RIDE THE SAME CONNECTION (SCANNER-RELAY-PLAN.md SR2) ────────────────────────────
 * The hello also carries the station's serial ports and its scanner readers' states, and its answer
 * names the scanners the station is to read. Each read is one `POST /scans`, under its OWN budget
 * (D-SR8): 1,800 per 15 minutes — two a second, sustained, which a person pulling a trigger cannot
 * outrun — and skipped by the budget above, so a busy unit check can never starve the print poll.
 */

export const LONG_POLL_MS = 25_000;
const POLL_EVERY_MS = 1_000;

declare module "express-serve-static-core" {
  interface Request {
    printStation?: StationRow;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function printStationRouter(options: { longPollMs?: number; pollEveryMs?: number } = {}): Router {
  const longPollMs = options.longPollMs ?? LONG_POLL_MS;
  const pollEveryMs = options.pollEveryMs ?? POLL_EVERY_MS;
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      skip: (req) => req.path === "/scans",
    }),
  );
  const scanLimit = rateLimit({ windowMs: 15 * 60_000, limit: 1_800, standardHeaders: "draft-7", legacyHeaders: false });
  router.use(json({ limit: "64kb" }));

  router.post(
    "/pair",
    validateBody(stationPairSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await pairStation(admin, res.locals.body as StationPairRequest);
      if (isServiceError(result)) {
        res.status(result.code === "invalid_pairing_code" ? 401 : 500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  router.use(
    asyncHandler(async (req, res, next) => {
      const header = req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const station = token ? await stationForToken(getSupabaseAdmin(getAppLocals(req).env), token) : null;
      if (!station) {
        res.status(401).json(apiError("unauthorized", "Invalid print station token"));
        return;
      }
      req.printStation = station;
      next();
    }),
  );

  router.post(
    "/hello",
    validateBody(stationHelloSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const hello = res.locals.body as StationHello;
      const error = (await stationHello(admin, req.printStation!, hello)) ?? (await recordStationPorts(admin, req.printStation!, hello));
      if (error) {
        res.status(500).json(apiError(error.code, error.error));
        return;
      }
      const scanners = await scannersForStation(admin, req.printStation!);
      if (isServiceError(scanners)) {
        res.status(500).json(apiError(scanners.code, scanners.error));
        return;
      }
      res.json({ ok: true, stationName: req.printStation!.name, scanners });
    }),
  );

  router.get(
    "/jobs/next",
    asyncHandler(async (req: Request, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      let gone = false;
      req.on("close", () => {
        gone = true;
      });
      const deadline = Date.now() + longPollMs;
      for (;;) {
        // A station that hung up is never handed a job: there would be nobody to print it.
        if (gone) return;
        const job = await claimNextJob(admin, req.printStation!.id);
        if (job && isServiceError(job)) {
          res.status(500).json(apiError(job.code, job.error));
          return;
        }
        if (job) {
          // Claimed but nobody left to hand it to: 0526 turns it `unknown` after two minutes, and the
          // screen offers Retry — never a silent loss.
          if (!gone) res.json({ ok: true, job });
          return;
        }
        if (Date.now() + pollEveryMs > deadline) break;
        await sleep(pollEveryMs);
      }
      res.status(204).end();
    }),
  );

  router.post(
    "/jobs/:id/report",
    validateBody(stationReportSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as StationReport;
      const result = await finishJob(
        getSupabaseAdmin(getAppLocals(req).env),
        req.printStation!.id,
        String(req.params.id),
        body.ok,
        body.error,
      );
      if (isServiceError(result)) {
        res.status(result.code === "not_found" ? 404 : result.code === "job_not_sent" ? 409 : 500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, status: result });
    }),
  );

  router.post(
    "/scans",
    scanLimit,
    validateBody(stationScanSchema),
    asyncHandler(async (req, res) => {
      const result = await recordRead(getSupabaseAdmin(getAppLocals(req).env), req.printStation!, res.locals.body as StationScanRequest);
      if (isServiceError(result)) {
        res.status(result.code === "not_found" ? 404 : 500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, delivered: result.delivered });
    }),
  );

  return router;
}
