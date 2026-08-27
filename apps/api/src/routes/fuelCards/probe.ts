import { Router } from "express";
import { z } from "zod";
import { policyNumberSchema } from "@silvicom/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import {
  getCardSummaries,
  getCardV2,
  getCardsWithNoDriverId,
  getPolicy,
} from "../../lib/efsCardOps.js";
import { searchLocation } from "../../lib/efsLocationSearch.js";
import { EfsSoapError, efsLogin } from "../../lib/efsSoapSession.js";
import { redactCardXml } from "../../lib/efsCardXml.js";
import { egressAddress } from "../../lib/egressAddress.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { resolveProbeCredentials } from "./probeGuards.js";

/**
 * Ask EFS, one operation at a time, what it will actually let this account do.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The card sweep calls `getCardSummariesV2` first and stops there, so a refusal tells you nothing
 * about the other four operations. When WEX asks "are you also getting Not Allowed on these methods?"
 * — which is the question that decides whether they widen an IP allowlist or look somewhere else —
 * the honest answer today is "we have not tried". This turns that into a table.
 *
 * ── The discriminator it was built for ───────────────────────────────────────────────────────────
 * `getCardv2` takes `clientId` and `cardNumber`: two required fields that are always populated. It is
 * the ONLY card operation whose request cannot be malformed by an omitted optional element. Every
 * other one carries something the guide calls "optional", and this codebase already learned the hard
 * way that EFS's Axis2 binding "rejects omitted filter elements even though the WSDL marks them
 * nillable" (docs/plans/EFS-SOAP-INTEGRATION-PLAN.md).
 *
 * So the two outcomes mean opposite things:
 *   • `getCardv2` SUCCEEDS, summaries fail  → our request shape was wrong, not the network.
 *   • ALL card operations fail, login works → nothing to do with request shape; it is access.
 *
 * Read-only. Nothing here mutates a card, and `setCardV2` is deliberately absent — the write probe
 * belongs at the Phase B gate, against a disposable QA card, and needs its own confirmation step.
 */

const probeSchema = z.object({
  /** A card number to try `getCardv2` against. Without it that step is skipped and so is the
   *  discriminator, which is the entire point — so the response says so out loud. */
  cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/).optional(),
  /**
   * Policy to try `getPolicy` against. Optional, and normally BETTER left unset: when absent, the
   * probe reads a policy number off a card this account actually owns. Asking EFS about a policy that
   * does not exist earns "Invalid policy number", which reads as a broken integration and is not one —
   * a guessed input produced exactly that false alarm in production.
   */
  policyNumber: policyNumberSchema.optional(),
});

/**
 * One vendor call's outcome, in the shape every diagnostic on this prefix reports.
 *
 * Exported with `step()` for `inventory.ts` (Step 7.2), whose Verify asks for "a `steps[]` array in
 * the `/diagnose` shape" — which is only true if it IS this shape rather than a second one that
 * looks like it. A copy would drift on the field that matters most: `error` is redacted here, and a
 * second implementation that forgot would leak a PAN out of a vendor refusal.
 */
export interface StepResult {
  operation: string;
  ok: boolean;
  ms: number;
  /** Rows or records returned, when the call succeeded. */
  count?: number;
  errorCode?: string;
  /** PAN-redacted. A refusal often quotes the request back. */
  error?: string;
}

export async function step(operation: string, run: () => Promise<number>): Promise<StepResult> {
  const started = Date.now();
  try {
    const count = await run();
    return { operation, ok: true, ms: Date.now() - started, count };
  } catch (error) {
    const efs = error instanceof EfsSoapError ? error : null;
    return {
      operation,
      ok: false,
      ms: Date.now() - started,
      errorCode: efs?.code ?? "unknown",
      // Redact unconditionally: a summaries failure can carry the fleet's card numbers, and a
      // getCardv2 failure quotes the one we asked about.
      error: redactCardXml(error instanceof Error ? error.message : String(error)).slice(0, 300),
    };
  }
}

export function fuelCardProbeRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/diagnose",
    requireOrg,
    // Admin only. It dials the vendor five times on a rate-paced shared account, and the answer is an
    // operations fact rather than anything a fleet manager acts on.
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const parsed = probeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid probe request"));
        return;
      }

      const creds = await resolveProbeCredentials(admin, env, orgId, parsed.data.cardNumber);

      const steps: StepResult[] = [];

      // Login first and on its own. If this fails, every other result is meaningless — and the
      // distinction between "credentials rejected" and "operation refused" is the whole point.
      steps.push(await step("login", async () => {
        await efsLogin(env, creds, "interactive");
        return 1;
      }));

      if (steps[0]!.ok) {
        // The discriminator. Only runs when a card number was supplied.
        if (parsed.data.cardNumber) {
          steps.push(await step("getCardv2", async () => {
            const doc = await getCardV2(env, creds, parsed.data.cardNumber!, { priority: "interactive" });
            return doc.card.infos.length;
          }));
        }
        // Keep the summaries themselves: they are the only place we can learn a policy number that
        // this account demonstrably owns.
        let summaries: Awaited<ReturnType<typeof getCardSummaries>> = [];
        steps.push(await step("getCardSummariesV2", async () => {
          summaries = await getCardSummaries(env, creds, { useV2: true, priority: "interactive" });
          return summaries.length;
        }));
        steps.push(await step("getCardSummaries", async () =>
          (await getCardSummaries(env, creds, { useV2: false, priority: "interactive" })).length));
        steps.push(await step("getCardsWithNoDriverId", async () =>
          (await getCardsWithNoDriverId(env, creds, { priority: "interactive" })).length));

        // Prefer a policy the fleet is actually on over one a human typed. Guarded by the same 1–99
        // range as the input, because a summary row is vendor data and is read tolerantly (see
        // cardControlContract.ts).
        const observedPolicy = summaries
          .map((row) => row.policyNumber)
          .find((n): n is number => typeof n === "number" && n >= 1 && n <= 99);
        const policyToProbe = parsed.data.policyNumber ?? observedPolicy;
        if (policyToProbe !== undefined) {
          steps.push(await step(`getPolicy(${policyToProbe})`, async () =>
            (await getPolicy(env, creds, policyToProbe, { priority: "interactive" })).limits.length));
        }
        steps.push(await step("searchLocation", async () =>
          (await searchLocation(env, creds, { state: "IL", name: "LOVES" }, { priority: "interactive" })).length));
      }

      const egressIp = await egressAddress();
      const cardSteps = steps.filter((s) => s.operation !== "login");
      const refused = cardSteps.filter((s) => !s.ok && (s.errorCode === "not_allowed" || /not\s*allowed/i.test(s.error ?? "")));
      const getCard = steps.find((s) => s.operation === "getCardv2");

      // State the conclusion rather than leaving five rows for a human to interpret at 2am.
      const verdict =
        !steps[0]!.ok
          ? "Login failed — nothing below is meaningful. Fix credentials or connectivity first."
          : getCard?.ok && refused.length > 0
            ? "getCardv2 SUCCEEDED while other operations were refused. Access is fine; the refused requests are malformed on our side — most likely an omitted element the Axis2 binding requires."
            : refused.length === cardSteps.length && cardSteps.length > 0
              // Not a judgement call. The guide defines NotAllowed as "Access blocked by firewall.
              // Contact your account manager." (p9), and gives a DIFFERENT code —
              // InvalidParameterNameID — for a request we built wrong. Getting the firewall code is
              // the vendor telling us to stop reading our own request bodies.
              ? "Every card operation was blocked at EFS's firewall while login succeeded. The guide (p9) defines NotAllowed as a firewall block, not an entitlement gap and not a bad request — a malformed request earns InvalidParameterNameID instead." +
                (egressIp
                  // A firewall keys on the address, so name it. These operations have already
                  // succeeded once from this same build, so what changed is on the network path.
                  ? ` We reached EFS from ${egressIp} — confirm that exact address is allowlisted, and compare it against the previous run's.`
                  : "")
              : cardSteps.every((s) => s.ok)
                ? "All card operations succeeded."
                : refused.length === 0
                  ? "Nothing was refused — EFS access is working. The failures below are ours to fix, not WEX's: check the per-operation error text."
                  : "Mixed results — see the per-operation errors below.";

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.card_probe",
        entity: "efs_soap_credentials",
        meta: {
          environment: creds.environment,
          verdict,
          // Persisted so two runs can be compared without anyone having kept the JSON: an address
          // that moves between runs IS the finding.
          egressIp,
          steps: steps.map((s) => ({ operation: s.operation, ok: s.ok, errorCode: s.errorCode ?? null })),
        },
      });

      res.json({ environment: creds.environment, egressIp, verdict, steps, testedCard: !!parsed.data.cardNumber });
    }),
  );

  return router;
}
