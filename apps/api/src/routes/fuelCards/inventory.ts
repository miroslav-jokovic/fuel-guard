import { Router } from "express";
import { z } from "zod";
import { getAppLocals } from "../../lib/appLocals.js";
import {
  getCardRefreshingLimits,
  getCarrierInfo,
  getContracts,
  getCreditLimits,
  getLocationGroupDescriptions,
  getLocationGroups,
  getPolicyDescriptions,
  getPolicyRefreshingLimits,
  getProductGroups,
  getProducts,
  getPromptTypes,
  getSitePolicyDescriptions,
  serverTime,
} from "../../lib/efsAccountOps.js";
import { doesCardPosition } from "../../lib/efsSecureFuelOps.js";
import { getCardV2, getPolicy } from "../../lib/efsCardOps.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { writeAudit } from "../../lib/audit.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { getEfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { loadCardNumber } from "../../services/efsCardMirror.js";
import { step, type StepResult } from "./probe.js";

/**
 * `POST /api/fuel-cards/account-inventory` — everything EFS will say about this ACCOUNT, in one walk
 * (execution plan Step 7.2).
 *
 * ── Read-only, and that is what makes it safe on production ─────────────────────────────────────
 * Every operation it calls is a read. Nothing here can change a card, a policy or a contract, which
 * is why it needs **no probe flag** — unlike `/write-check` and `/prove`, which can dispatch a real
 * `setCardV2` and are gated by `EFS_CARD_CONTROL_PROBE_ENABLED` for that reason. Same posture as the
 * echo scan and the linking sweep, both of which have run against the production org.
 *
 * ── Admin only ──────────────────────────────────────────────────────────────────────────────────
 * It dials a rate-paced shared vendor account up to two dozen times, and the answer is an operations
 * fact that scopes Phases 9–12 rather than anything a fleet manager acts on. Same gate as
 * `/diagnose`.
 *
 * ── Never fails whole ───────────────────────────────────────────────────────────────────────────
 * Each call is wrapped in `step()` — the `/diagnose` helper, imported rather than reimplemented, so
 * the `steps[]` array really is the same shape and the PAN redaction on a failed step is the same
 * code. A refusal on one operation records itself and the walk continues, because "which of these
 * thirteen does this account refuse" is precisely the question, and a walk that aborted on the first
 * refusal could never answer it.
 */

/**
 * ⚠ THE REQUEST BUDGET IS THE DESIGN CONSTRAINT, and the plan does not say how to meet it.
 *
 * Step 7.2's Verify is "route test under 28 requests". The account walk's fixed cost is TEN:
 *
 *   login · getCarrierInfo · doesCardPosition · getPromptTypes · getContracts ·
 *   getPolicyDescriptions · getProductGroups · getProducts · getLocationGroupDescriptions ·
 *   getSitePolicyDescriptions · serverTime
 *
 * That leaves **18** for the two loops, which cost one call per contract and TWO per policy
 * (`getPolicy` + `getPolicyRefreshingLimits`). So the loops must be bounded, or an account with a
 * dozen policies silently blows the budget this step exists to hold:
 *
 *   MAX_CONTRACTS(4) + 2 × MAX_POLICIES(7) = 4 + 14 = 18,  and 11 + 18 = 29.
 *
 * The eleven counts the login. It happens only when no session is cached, so a warm walk costs 28 —
 * which is why the response reports `operations` (what it definitely did) rather than a request
 * count it would have to guess at.
 *
 * ── The fixed cost was TEN until `docs/37` §6 A, and the budget moved with it ───────────────────
 * `doesCardPosition` is the eleventh, and it raised `INVENTORY_REQUEST_BUDGET` from 28 to 29 — the
 * deliberate raise this docblock's truncation note asks for, rather than a cap quietly lowered to
 * keep an old number true. Lowering `MAX_POLICIES` to absorb it was the alternative and would have
 * been the wrong trade: the policies are where `ODRD` actually lives (`docs/37` §5a), so paying for
 * the SecureFuel flag by walking fewer policies would buy the question and sell the answer.
 *
 * **Nothing is truncated silently.** `truncated` in the response names what was left out and how
 * many, because a bounded walk reported as a complete one is worse than no walk — it would scope
 * Phases 9–12 off a partial answer while looking authoritative. Raise the caps deliberately, and
 * `INVENTORY_REQUEST_BUDGET` with them, when a real account needs it.
 *
 * ── One addition to the step's written sequence, and why ────────────────────────────────────────
 * The sequence in Step 7.2 does not list `getSitePolicyDescriptions`. It is included anyway, because
 * Step 7.1 built that operation and this is the only route that could call it — leaving it out would
 * ship an operation with no caller, which is precisely the defect the Phase 6.7 audit spent a day
 * closing. It also belongs to the question 7.6 has to answer about what governs each pump.
 */
const MAX_CONTRACTS = 4;
const MAX_POLICIES = 7;
/**
 * The Verify's own number, raised by one for `doesCardPosition`. Asserted in the route test against
 * the actual call count, not assumed — see the docblock above for why the raise was the right side
 * of the trade.
 */
export const INVENTORY_REQUEST_BUDGET = 29;

/**
 * Sample cards are charged SEPARATELY and deliberately.
 *
 * THREE calls each (`getCardv2` + `getCardRefreshingLimits` + `getLocationGroups`), so 25 cards is 75
 * requests on its own — far past the 28 the account walk is held to. That is not a contradiction: the budget bounds the
 * ACCOUNT walk, which is the part that runs unattended and whose size an operator cannot see. Sample
 * cards are an explicit, counted opt-in on top of it.
 */
const MAX_SAMPLE_CARDS = 25;

const inventorySchema = z.object({
  /**
   * `efs_cards.id` values — uuids, never PANs. The card number is resolved server-side through
   * `loadCardNumber`, which is org-scoped, so no card number reaches a request body, an access log,
   * a Referer header or browser history. Standing rule 13.
   */
  sampleCards: z.array(z.string().uuid()).max(MAX_SAMPLE_CARDS).optional(),
});

interface InventoryTruncation {
  what: string;
  seen: number;
  walked: number;
}

export function fuelCardInventoryRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/account-inventory",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const parsed = inventorySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid request"));
        return;
      }

      const creds = await getEfsSoapCredentials(admin, env, orgId);
      if (!creds?.enabled) {
        res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
        return;
      }

      const steps: StepResult[] = [];
      const truncated: InventoryTruncation[] = [];
      const opts = { priority: "backfill" as const };

      // ── The account, first ──────────────────────────────────────────────────────────────────
      // `getCarrierInfo` leads the sequence because `locationGroups: false` makes every
      // location-group question below moot, and learning that after twelve more calls is late.
      let carrierInfo: Awaited<ReturnType<typeof getCarrierInfo>> | null = null;
      steps.push(await step("getCarrierInfo", async () => {
        carrierInfo = await getCarrierInfo(env, creds, opts);
        return 1;
      }));

      /**
       * `docs/37` §6 A — the cheapest question in the walk, and the one that gates every odometer
       * question after it.
       *
       * Placed straight after `getCarrierInfo` for the same reason that one leads: on an account
       * answering false, the accrual window, the stored mileage and the override are all inert, and
       * a thirteen-call walk that never asks has to guess. One call, no parameters beyond the
       * session.
       *
       * Null is a THIRD state and is preserved as one — "we asked and could not tell" is not
       * "SecureFuel is off", and `doesCardPosition` reads its answer out of its own part name
       * precisely so those two cannot collapse into each other.
       */
      let securefuel: boolean | null = null;
      steps.push(await step("doesCardPosition", async () => {
        securefuel = await doesCardPosition(env, creds, opts);
        return 1;
      }));

      let promptTypes: string[] = [];
      steps.push(await step("getPromptTypes", async () => {
        promptTypes = await getPromptTypes(env, creds, opts);
        return promptTypes.length;
      }));

      // ── Contracts, and the real ceiling on each ─────────────────────────────────────────────
      let contracts: Awaited<ReturnType<typeof getContracts>> = [];
      steps.push(await step("getContracts", async () => {
        contracts = await getContracts(env, creds, opts);
        return contracts.length;
      }));

      const walkedContracts = contracts.slice(0, MAX_CONTRACTS);
      if (contracts.length > walkedContracts.length) {
        truncated.push({ what: "contracts", seen: contracts.length, walked: walkedContracts.length });
      }
      const creditLimits: { contractId: number | null; limits: unknown }[] = [];
      for (const contract of walkedContracts) {
        if (contract.contractId === null) continue;
        const id = contract.contractId;
        steps.push(await step(`getCreditLimits(${id})`, async () => {
          creditLimits.push({ contractId: id, limits: await getCreditLimits(env, creds, id, opts) });
          return 1;
        }));
      }

      // ── Policies: what each one is called, what it sets, and its refreshing limits ───────────
      let policyDescriptions: Awaited<ReturnType<typeof getPolicyDescriptions>> = [];
      steps.push(await step("getPolicyDescriptions", async () => {
        policyDescriptions = await getPolicyDescriptions(env, creds, opts);
        return policyDescriptions.length;
      }));

      const walkedPolicies = policyDescriptions.slice(0, MAX_POLICIES);
      if (policyDescriptions.length > walkedPolicies.length) {
        truncated.push({ what: "policies", seen: policyDescriptions.length, walked: walkedPolicies.length });
      }
      const policies: { policyNumber: number; policy: unknown; refreshingLimits: unknown }[] = [];
      for (const description of walkedPolicies) {
        const n = description.policyNumber;
        // A policy number EFS reports is read tolerantly (vendorInt), so it can be null or outside
        // 1–99. Asking EFS about one earns "Invalid policy number", which reads as a broken
        // integration and is not one — the same false alarm `/diagnose` records having produced.
        if (n === null || n < 1 || n > 99) continue;
        let policy: unknown = null;
        let refreshingLimits: unknown = null;
        steps.push(await step(`getPolicy(${n})`, async () => {
          policy = await getPolicy(env, creds, n, opts);
          return 1;
        }));
        steps.push(await step(`getPolicyRefreshingLimits(${n})`, async () => {
          refreshingLimits = await getPolicyRefreshingLimits(env, creds, n, opts);
          return 1;
        }));
        policies.push({ policyNumber: n, policy, refreshingLimits });
      }

      // ── The vocabulary ──────────────────────────────────────────────────────────────────────
      let productGroups: Awaited<ReturnType<typeof getProductGroups>> = [];
      steps.push(await step("getProductGroups", async () => {
        productGroups = await getProductGroups(env, creds, opts);
        return productGroups.length;
      }));
      let products: Awaited<ReturnType<typeof getProducts>> = [];
      steps.push(await step("getProducts", async () => {
        products = await getProducts(env, creds, opts);
        return products.length;
      }));

      // ── Location groups ─────────────────────────────────────────────────────────────────────
      // `getLocationGroupDescriptions`, NOT `getLocationGroups`. The latter's WSDL parameterOrder is
      // `clientId cardNum policyNum`, so it always asks about a specific card or policy and cannot
      // answer an account-level question at all. It is reachable only through `sampleCards`.
      let locationGroups: Awaited<ReturnType<typeof getLocationGroupDescriptions>> = [];
      steps.push(await step("getLocationGroupDescriptions", async () => {
        locationGroups = await getLocationGroupDescriptions(env, creds, opts);
        return locationGroups.length;
      }));

      let sitePolicies: Awaited<ReturnType<typeof getSitePolicyDescriptions>> = [];
      steps.push(await step("getSitePolicyDescriptions", async () => {
        sitePolicies = await getSitePolicyDescriptions(env, creds, opts);
        return sitePolicies.length;
      }));

      // ── EFS's own clock, last ───────────────────────────────────────────────────────────────
      let efsTime: string | null = null;
      steps.push(await step("serverTime", async () => {
        efsTime = await serverTime(env, creds, opts);
        return 1;
      }));

      // ── Optional: a few real cards ──────────────────────────────────────────────────────────
      const sampled: { cardId: string; card: unknown; refreshingLimits: unknown; locationGroups: unknown }[] = [];
      for (const cardId of parsed.data.sampleCards ?? []) {
        // Org-scoped by `loadCardNumber`, and the ONLY place a PAN enters this route's memory.
        const cardNumber = await loadCardNumber(admin, env, orgId, cardId);
        if (!cardNumber) continue;
        let card: unknown = null;
        let refreshingLimits: unknown = null;
        // The step LABEL carries the uuid, never the card number: these strings are rendered.
        steps.push(await step(`getCardv2(${cardId})`, async () => {
          card = (await getCardV2(env, creds, cardNumber, opts)).card;
          return 1;
        }));
        steps.push(await step(`getCardRefreshingLimits(${cardId})`, async () => {
          refreshingLimits = await getCardRefreshingLimits(env, creds, cardNumber, opts);
          return 1;
        }));
        // The only place `getLocationGroups` can legitimately be called: it needs a card or a policy
        // (`parameterOrder="clientId cardNum policyNum"`), so the account walk above cannot use it.
        // Without this it would be an operation with no caller — see the note on the budget above.
        let cardLocationGroups: unknown = null;
        steps.push(await step(`getLocationGroups(${cardId})`, async () => {
          cardLocationGroups = await getLocationGroups(env, creds, { cardNumber }, opts);
          return 1;
        }));
        sampled.push({ cardId, card, refreshingLimits, locationGroups: cardLocationGroups });
      }

      /**
       * Step 9.1. This walk is the ONLY reader of `getPromptTypes`, so it is the only place the
       * account's prompt vocabulary can be captured — and until now it returned that vocabulary to
       * one operator's screen and then dropped it.
       *
       * Persisted here rather than fetched on the write path because the vendor's rate limiter is
       * keyed on IP rather than on the account it protects (Step 5.6): a `getPromptTypes` in front
       * of every prompt edit would spend that budget on a list that changes roughly never, and would
       * make a rate-limited account one whose prompts cannot be edited at all.
       *
       * Best-effort, and deliberately AFTER every vendor call. A failure to cache must not fail a
       * read-only walk that has already succeeded — the resolver's documented fallback covers a
       * missing row, and the operator still has the inventory in front of them. Only a non-empty
       * read is written: migration 0200 refuses `'{}'` precisely so that "the account said nothing"
       * cannot be stored as if it were an answer.
       *
       * Reported in its own field rather than pushed onto `steps[]`, for two reasons that both bite.
       * `steps[]` is the `/diagnose` shape and its length IS `operations`, which the response
       * documents as vendor operations and which the request budget is checked against — a database
       * write counted there would make both numbers lies. And `ok` is `steps.every(s => s.ok)`, so a
       * failed cache would report the whole read-only walk as failed when every vendor call landed.
       * Silence is not the alternative: a cache that quietly did not write leaves the editable set on
       * the 2-id fallback with nothing on screen to say why, which is the failure this field exists
       * to make visible.
       */
      let promptTypesCached: { ok: boolean; error?: string } | null = null;
      if (promptTypes.length > 0) {
        const { error } = await admin
          .from("efs_card_control_settings")
          .upsert(
            { org_id: orgId, prompt_types: promptTypes, prompt_types_at: new Date().toISOString() },
            { onConflict: "org_id" },
          );
        promptTypesCached = error ? { ok: false, error: error.message } : { ok: true };
      }

      /**
       * Step 10.3, and the same argument as the block above one phase later: this walk is the only
       * reader of `getProductGroups`, and until now it returned the account's LIMIT vocabulary to one
       * operator's screen and then dropped it.
       *
       * ⚠ `productGroups`, not `products`. Both handoffs name `getProducts`; the guide points
       * `groupId` at its Limit IDs table and `code` at nothing, and ten documented limit ids — DSL,
       * GAS, JET among them — exist on this account ONLY as groups. A picker fed from products could
       * not have offered DSL, which WEX's Overrides guide says every diesel override needs.
       *
       * Stored whole rather than as bare ids: `description` is the wording the operator already sees
       * in the WEX portal, and `isFuel` is what decides gallons versus dollars (p36). Both would
       * otherwise cost a second vendor call to recover.
       *
       * Its own upsert rather than one merged with the prompts write above, and deliberately: two
       * facts read by two different vendor calls fail independently, and merging them would let a
       * prompt-vocabulary failure discard a product vocabulary that arrived perfectly well. Reported
       * in its own field for the reasons the block above spells out — `steps[]` is the `/diagnose`
       * shape and its length IS `operations`, which a database write must not inflate.
       */
      let productGroupsCached: { ok: boolean; error?: string } | null = null;
      if (productGroups.length > 0) {
        const { error } = await admin
          .from("efs_card_control_settings")
          .upsert(
            { org_id: orgId, product_groups: productGroups, product_groups_at: new Date().toISOString() },
            { onConflict: "org_id" },
          );
        productGroupsCached = error ? { ok: false, error: error.message } : { ok: true };
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "efs.account_inventory",
        entity: "org",
        entityId: orgId,
        meta: { steps: steps.length, failed: steps.filter((s) => !s.ok).length, sampled: sampled.length },
      });

      res.json({
        ok: steps.every((s) => s.ok),
        /**
         * Vendor OPERATIONS this walk performed. Not "requests": `withEfsSession` reuses a cached
         * session, so the login that precedes the first operation happens on some walks and not
         * others — reporting `operations + 1` would have been a guess that is wrong whenever the
         * session was warm. The budget below covers operations plus at most one login.
         */
        operations: steps.length,
        requestBudget: INVENTORY_REQUEST_BUDGET,
        /** Non-empty means this walk did NOT see the whole account. Never omitted when it applies. */
        truncated,
        /**
         * Step 9.1's cache write. `null` when `getPromptTypes` returned nothing to store, so an
         * operator can tell "we did not write" from "we wrote and it failed" — the two have very
         * different fixes and the same symptom, an editable set stuck on the fallback pair.
         */
        promptTypesCached,
        /** Step 10.3's cache write, reported on the same terms and for the same reason. */
        productGroupsCached,
        steps,
        inventory: {
          carrierInfo,
          /**
           * `docs/37` §6 A — the thirteenth question, and now the account's own answer to it.
           *
           * Three-valued and reported as such: `true`, `false`, or `null` for "we asked and could
           * not tell". Collapsing null to false would report a SecureFuel account as unprotected,
           * which is the more dangerous of the two wrong answers — it is the one that makes an
           * operator believe the odometer prompt at the pump does nothing.
           */
          securefuel,
          promptTypes,
          contracts,
          creditLimits,
          policies,
          productGroups,
          products,
          locationGroups,
          sitePolicies,
          serverTime: efsTime,
          sampledCards: sampled,
        },
      });
    }),
  );

  return router;
}
