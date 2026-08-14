import { Router } from "express";
import { z } from "zod";
import { cardLast4 } from "@fuelguard/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { assertEchoFidelity, serializeSetCardRequest } from "../../lib/efsCardEcho.js";
import { getCardSummaries, getCardV2 } from "../../lib/efsCardOps.js";
import { CONTAINER, NIL, documentShape, redactCardXml } from "../../lib/efsCardXml.js";
import { efsLogin } from "../../lib/efsSoapSession.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { resolveReadOnlyScanCredentials } from "./probeGuards.js";

/**
 * Read every card in the account, build the request we WOULD send, and check it — dispatching nothing.
 *
 * ── What this proves that the fixture suite cannot ───────────────────────────────────────────────
 * Every echo test in the repo runs against XML we wrote, on ten fixtures. This runs the same guard
 * against XML WEX wrote, for every real card on the account. A card carrying a field, a collection or
 * a document shape no fixture has is exactly the card the echo would silently mangle, and the only
 * way to find it is to look at all of them.
 *
 * It has grown teeth since it was specified. The guard it runs now also refuses a dropped record, a
 * dropped field, and a request out of WSCardv2 sequence — so a clean scan is a much stronger
 * statement than it would have been three steps ago.
 *
 * ── Never dispatches ─────────────────────────────────────────────────────────────────────────────
 * `setCardV2` is not imported by this module, and `echoScan.test.ts` asserts that it is not. That is
 * a structural guarantee rather than a careful one: the safety property here is not "we remembered
 * not to write", it is "there is no write to reach". A zero-edit echo is still a full-document write
 * if anything sends it, which is precisely why the write probe demands a typed confirmation and this
 * endpoint has none — it cannot send.
 *
 * ── Neither probe flag, and why ──────────────────────────────────────────────────────────────────
 * `EFS_CARD_CONTROL_PROBE_ENABLED` gates the endpoints that can WRITE. Gating a read-only diagnostic
 * behind the same flag would mean toggling the write flag on production to run it, which is worse
 * than not having the flag.
 *
 * The same reasoning applies to `EFS_ALLOW_PRODUCTION_PROBE`, and the first version of this file
 * MISSED it: reusing `resolveProbeCredentials` for its credential lookup silently inherited that
 * gate too, and the endpoint answered 403 on the production org — the only org whose 199 cards the
 * exit gate cares about. Reusing a helper for one of its behaviours gets you all of them. It now
 * uses `resolveReadOnlyScanCredentials`, which is the same lookup without the production gate; see
 * the note there for what still guards this route.
 *
 * Admin and org scope still apply, and the vendor rate limiter charges it.
 *
 * ── Batched on purpose ───────────────────────────────────────────────────────────────────────────
 * The backfill lane is `EFS_SOAP_MAX_RPS - live`, which is 0.6 rps at the defaults — around six
 * minutes for 199 cards, well past any sane HTTP timeout, and all of it competing with the pollers.
 * So the scan takes `limit`/`offset`, reports `nextOffset`, and stops early on its own wall clock
 * rather than hanging. Run it as a handful of calls and add up the failures.
 */

const echoScanSchema = z.object({
  /** Cards per call. Small by design — see the pacing note above. */
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  /** Wall-clock budget for one call. Stops cleanly and reports where to resume. */
  maxMs: z.coerce.number().int().min(5_000).max(240_000).default(60_000),
});

interface CardResult {
  /** The card is identified by its last four ONLY. A PAN never enters this response. */
  last4: string | null;
  ok: boolean;
  shape?: string;
  /** Present only on an echo failure: the canonical paths that differ, values redacted. */
  diffs?: { path: string; expected: string; actual: string }[];
  /** Present when the card could not be read or checked at all — never conflated with a clean pass. */
  error?: string;
}

/**
 * A canonical leaf, made readable and stripped of anything PAN-shaped.
 *
 * The encoding prefixes real values with `v`, so a bare digit run only becomes visible to
 * `redactCardXml`'s `\b\d{10,25}\b` once the prefix is off. Belt and braces: `cardNumber` is already
 * excluded from the canonical comparison as a request input, so a PAN should never reach here.
 */
function showValue(encoded: string): string {
  if (encoded === NIL) return "(nil)";
  if (encoded === CONTAINER) return "(container)";
  return redactCardXml(encoded.startsWith("v") ? encoded.slice(1) : encoded);
}

export function fuelCardEchoScanRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/echo-scan",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const parsed = echoScanSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid scan request"));
        return;
      }
      const { limit, offset, maxMs } = parsed.data;

      const creds = await resolveReadOnlyScanCredentials(admin, env, orgId);
      await efsLogin(env, creds, "backfill");

      const summaries = await getCardSummaries(env, creds, { priority: "backfill" });
      const window = summaries.slice(offset, offset + limit);

      const startedAt = Date.now();
      const results: CardResult[] = [];
      let truncated = false;

      for (const summary of window) {
        if (Date.now() - startedAt > maxMs) {
          truncated = true;
          break;
        }
        results.push(await scanOne(env, creds, summary.cardNumber));
      }

      const scanned = results.length;
      const failed = results.filter((r) => !r.ok).length;
      const nextIndex = offset + scanned;
      const done = !truncated && nextIndex >= summaries.length;

      // The card numbers are gone by here; only last4 survives into the audit row.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "efs.echo_scan",
        meta: { scanned, failed, offset, total: summaries.length, failedLast4: results.filter((r) => !r.ok).map((r) => r.last4) },
      });

      res.json({
        total: summaries.length,
        offset,
        scanned,
        passed: scanned - failed,
        failed,
        truncated,
        nextOffset: done ? null : nextIndex,
        results,
      });
    }),
  );

  return router;
}

/**
 * One card: read it, build the zero-edit request, judge it.
 *
 * A card that throws is recorded and the scan continues. One unreadable card must not hide the other
 * 198, and it must not be counted as a pass either — `ok` is false and the reason is reported.
 */
async function scanOne(
  env: ReturnType<typeof getAppLocals>["env"],
  creds: Awaited<ReturnType<typeof resolveReadOnlyScanCredentials>>,
  cardNumber: string,
): Promise<CardResult> {
  const last4 = cardLast4(cardNumber);
  try {
    const doc = await getCardV2(env, creds, cardNumber, { priority: "backfill" });
    const { xml } = serializeSetCardRequest(doc, { clientId: "echo-scan", cardNumber }, []);
    assertEchoFidelity(doc, xml, []);
    return { last4, ok: true, shape: documentShape(doc) };
  } catch (error) {
    const detail = (error as { detail?: { diffs?: { path: string; expected: string[]; actual: string[] }[] } })?.detail;
    if (detail?.diffs) {
      return {
        last4,
        ok: false,
        diffs: detail.diffs.map((d) => ({
          path: d.path,
          expected: d.expected.map(showValue).join(", "),
          actual: d.actual.map(showValue).join(", "),
        })),
      };
    }
    return { last4, ok: false, error: redactCardXml(error instanceof Error ? error.message : String(error)) };
  }
}
