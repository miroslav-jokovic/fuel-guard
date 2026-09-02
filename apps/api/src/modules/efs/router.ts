import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../lib/http.js";
import { requireAuth, requireOrg, requireSection } from "../../middleware/auth.js";
import { DEFAULT_STEP_UP_MAX_AGE_SEC, hasFreshAuth, stepUpRequired } from "../../middleware/requireFreshAuth.js";
import { ActionRefusalError } from "./services/efsCardControlErrors.js";
import {
  badRequest,
  controlErrorResponse,
  mutationFingerprint,
  prepare,
} from "./routes/controlPrepare.js";
import { mountedCapabilities, type AcceptedRequest, type MountedCapability } from "./registry.js";
import type { Env } from "../../env.js";
import type { CardScope } from "./services/efsCardControlAccess.js";

/**
 * One handler, looped over the registry. No hand-written route per capability.
 *
 * ── What this replaces, and why that is the point ────────────────────────────────────────────────
 * The five handlers in `routes/fuelCards/control.ts` are the same twenty lines five times: parse,
 * gate, fingerprint, execute, map errors. Five copies is five chances for one of them to forget the
 * write limiter, mis-declare its bucket, or map a refusal to the wrong status — and `cardWriteBucket`
 * returns null on a miss while the limiter treats null as ALLOW, so the failure mode of a mistake
 * here is an unmetered write route rather than a broken one.
 *
 * Step 3.5 moves `card_lock` onto this loop. 3.6 moves the remaining four and 3.7 deletes the
 * hand-written file (docs/27 §7.1).
 *
 * ── The order of the two gates is the whole of Step 3.5b ─────────────────────────────────────────
 * `accept()` parses the body and answers `preflightStepUp` from the body ALONE. That happens before
 * `prepare()`, which ends with `enforceCardWriteLimit`. A capability that refuses on the body — "you
 * may not grant more than three uses without re-authenticating" — therefore refuses for free, and the
 * operator who re-authenticates still has their full daily budget. Reversing these two spends a slot
 * on every refusal, and the operator is rate-limited out of an action they were always going to be
 * allowed to take.
 */
/**
 * @param env decides which capabilities are served — today only the override-clear mechanism varies.
 * @param capabilities defaults to that list. Overridden only by router.test.ts, which needs a
 * capability that DECLARES a `preflightStepUp`; it proves the ordering in the case titled
 * "refuses without charging a slot". `card_lock` has no preflight, deliberately, and the first real one
 * arrives with `override_grant` in Step 3.6. Asserting the ordering by reading this file's source
 * instead would be the kind of structural test that passed twice while the echo-scan endpoint was
 * broken in production.
 */
export function fuelCardCapabilityRouter(
  env: Env,
  capabilities: readonly MountedCapability[] = mountedCapabilities(env),
): Router {
  const router = Router();
  router.use(requireAuth);

  const canManage = requireSection("fuel");

  for (const capability of capabilities) {
    const { method, path } = capability.contract.route;
    const handler = asyncHandler((req: Request, res: Response) => handle(capability, req, res));
    if (method === "POST") router.post(path, requireOrg, canManage, handler);
    else router.delete(path, requireOrg, canManage, handler);
  }

  return router;
}

/**
 * The card whose version we have never had (Step 7.5).
 *
 * `upsertFromSummary` writes `card_version: ""` on a first sighting, because `getCardSummaries`
 * carries no document and the column is not-null. The card page renders that row, the drawer sends
 * `expectedVersion: ""` — and `cardVersionSchema` is `min(16)`, so the operator's Confirm came back
 * as **"Could not change the card — String must contain at least 16 character(s)"**. A schema
 * message, about a field they never saw, describing a card the product simply had not read yet.
 *
 * ⚠ The execution plan files this as *"a 409 that claims the card changed"*, and that is the one
 * thing it is NOT: `assertUnmoved`'s comparison is downstream of this schema and unreachable with an
 * empty version. A fix placed there would have been dead code that reads like coverage. Checked by
 * following the value, not by reading the step.
 *
 * Ahead of `accept()` so the honest message wins over the schema's, and ahead of `prepare()` so a
 * refusal costs no rate-limit slot — the same ordering, and the same reason, as the step-up gate
 * below it. The card is NOT read here: dialling the vendor before `prepare()` would be a write-path
 * vendor call outside the limiter it exists to sit behind. `POST /:id/refresh` is the action, and
 * the sentence names it.
 */
function refuseRosterOnlyVersion(req: Request, res: Response): boolean {
  const version = (req.body as { expectedVersion?: unknown } | undefined)?.expectedVersion;
  if (version !== "") return false;
  res.status(409).json({
    error: {
      code: "card_never_read",
      message:
        "This card has not been read from EFS yet, so there is nothing to check your change against. "
        + "Refresh the card, then try again.",
    },
  });
  return true;
}

async function handle(capability: MountedCapability, req: Request, res: Response): Promise<void> {
  const { contract } = capability;

  if (refuseRosterOnlyVersion(req, res)) return;

  const accepted = capability.accept(req.body ?? {});
  if (!accepted.ok) { badRequest(res, accepted.error); return; }

  // BEFORE prepare(), and therefore before a rate-limit slot is spent. Body-only by type: this
  // decision cannot consult the card, because the card has not been read yet — the gates that need
  // the fresh document are `planStepUp` and `precondition`, and the orchestrator runs those.
  if (accepted.stepUpMessage && !hasFreshAuth(req)) {
    stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, accepted.stepUpMessage);
    return;
  }

  const prepared = await prepare(req, res, contract.scope as CardScope, contract.key);
  if (!prepared) return;

  await run(res, prepared.ctx, accepted, contract.intent, prepared.ctx.efsCardId);
}

async function run(
  res: Response,
  ctx: Parameters<AcceptedRequest["run"]>[0],
  accepted: AcceptedRequest,
  intent: string,
  efsCardId: string,
): Promise<void> {
  try {
    const outcome = await accepted.run({
      ...ctx,
      expectedVersion: accepted.expectedVersion,
      requestFingerprint: mutationFingerprint(intent, efsCardId, accepted.fingerprintBody),
    });
    // 200 for every RECORDED outcome, including 'failed' and 'sent'. The request succeeded — we
    // asked EFS and wrote down what happened. Returning 502 for a vendor refusal would throw away
    // the mutation id the operator needs in order to look the attempt up.
    res.json({ ok: outcome.status === "succeeded", ...outcome });
  } catch (error) {
    // A refusal decided against the FRESH document surfaces before any ledger row exists — the same
    // recovery shape wherever it is thrown from.
    if (error instanceof ActionRefusalError) {
      if (error.code === "step_up_required") { stepUpRequired(res, DEFAULT_STEP_UP_MAX_AGE_SEC, error.message); return; }
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }
    controlErrorResponse(res, error);
  }
}
