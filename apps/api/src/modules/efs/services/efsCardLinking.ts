import type { SupabaseClient } from "@supabase/supabase-js";
import { FULL_PAN_MIN_DIGITS, cardDigits } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { open, secretAad } from "../../../lib/secretBox.js";

/**
 * Which `fuel_cards` row is this mirrored EFS card? (Step 7.7)
 *
 * Split out of `efsCardMirror.ts` when the tiered matcher took that file past the 500-line budget.
 * The seam is a real one and predates the size problem: mirroring answers "what does EFS say about
 * this card", linking answers "which of OUR records is the same physical card". The second question
 * is the one that decides whether a fill is attributed to the right truck, and it is the one this
 * fleet's data makes hard — so it earns its own file and its own tests.
 *
 * Splitting was chosen over a `check-file-size` waiver deliberately: a waiver pins the file at its
 * current length and makes the next addition somebody else's problem.
 */

/**
 * Point each mirror row at its `fuel_cards` row, where that can be established without guessing.
 *
 * ── The defect this replaced, in the codebase's own words (Step 7.7) ────────────────────────────
 * This function decided identity with `cardRefsMatch`, whose doc comment forbids precisely that:
 * *"a COMPATIBILITY test, not an identity test … Anything that decides 'these two rows are the SAME
 * card' must use `sameCardFill` (or compare `cardIdentityKey`s) instead."* The warning and the
 * violation sat two files apart for months and nobody joined them.
 *
 * It was not hypothetical. On the production fleet **40 last-4 groups hold more than one live card,
 * covering 144 of 197**, so a last-4 comparison could only refuse or mis-attribute. It refused —
 * 143 cards unlinked, fuel attribution running on a quarter of the fleet — which was the right half
 * of a wrong design. `••••7552` alone is five distinct cards on five different units.
 *
 * ── Three tiers, each requiring uniqueness, strongest first ─────────────────────────────────────
 *   1. `pan_exact`  — the sealed EFS card number and `fuel_cards.card_ref` are the SAME full number.
 *                     All 173 production `card_ref`s are distinct 19-digit PANs, so a hit here is
 *                     an identity, not a heuristic.
 *   2. `pan_suffix` — one full number is the trailing suffix of the other, both >= 8 digits, and
 *                     exactly one candidate matches. This exists because the two systems are not
 *                     guaranteed to store the same LENGTH: EFS is the vendor's format, `card_ref`
 *                     comes from a fuel import. Eight digits is far past a last-4 guess.
 *   3. `last4_unit` — last four plus the truck. `efs_cards.unit_prompt` resolved against
 *                     `vehicles.unit_number`, matched to the candidate's `vehicle_id`. Two cards
 *                     sharing a last-4 on the SAME unit would still be refused.
 *
 * ── What is deliberately NOT built ──────────────────────────────────────────────────────────────
 * The plan also names "(last-4 + driver)". `fuel_cards.driver_id` is **null on all 173 production
 * rows**, so that tier would be dead code that reads like coverage. Measured, not assumed, and left
 * out until there is data behind it.
 *
 * ── Fails safe on the one thing that cannot be checked offline ──────────────────────────────────
 * Whether EFS's card number equals the imported `card_ref` cannot be proven from this side — the
 * numbers are sealed. Tier 1 requires exact digit equality and tier 2 an 8+ digit suffix, so if the
 * two formats disagree these tiers match NOTHING and the linker falls through to tier 3. The failure
 * mode is fewer links, never a wrong one, and `fuel_card_link.method` records which tier fired so a
 * single live sweep answers the question this comment cannot.
 *
 * Tombstoned rows are skipped: a card WEX has de-listed has no counterpart to find, and trying is
 * how a sweep spends its effort on two cards that no longer exist.
 */
export async function linkFuelCards(admin: SupabaseClient, env: Env, orgId: string): Promise<number> {
  const { data: unlinked } = await admin
    .from("efs_cards")
    .select("id, card_last4, unit_prompt, card_number_sealed")
    .eq("org_id", orgId)
    .is("fuel_card_id", null)
    .is("absent_since", null)
    .limit(1000);
  if (!unlinked?.length) return 0;

  const { data: candidates } = await admin
    .from("fuel_cards")
    .select("id, card_ref, card_last4, vehicle_id")
    .eq("org_id", orgId)
    .eq("provider", "efs")
    .limit(2000);
  if (!candidates?.length) return 0;

  const { data: vehicles } = await admin
    .from("vehicles")
    .select("id, unit_number")
    .eq("org_id", orgId)
    .limit(5000);
  const unitOfVehicle = new Map(
    ((vehicles ?? []) as { id: string; unit_number: string | null }[])
      .map((v) => [v.id, normalizeUnit(v.unit_number)] as const),
  );

  const pool = (candidates as FuelCardCandidate[]).map((c) => ({
    ...c,
    digits: cardDigits(c.card_ref),
    unit: c.vehicle_id ? unitOfVehicle.get(c.vehicle_id) ?? null : null,
  }));

  let linked = 0;
  for (const row of unlinked as UnlinkedCard[]) {
    const verdict = matchOneCard(env, orgId, row, pool);
    const patch: Record<string, unknown> = {
      fuel_card_link: {
        status: verdict.status,
        method: verdict.method,
        candidates: verdict.candidates,
        at: new Date().toISOString(),
      },
    };
    if (verdict.status === "linked") patch.fuel_card_id = verdict.candidates[0];

    const { error } = await admin
      .from("efs_cards")
      .update(patch)
      .eq("id", row.id)
      .eq("org_id", orgId);
    if (!error && verdict.status === "linked") linked += 1;
  }
  return linked;
}

export interface UnlinkedCard {
  id: string;
  card_last4: string | null;
  unit_prompt: string | null;
  card_number_sealed: string | null;
}

export interface FuelCardCandidate {
  id: string;
  card_ref: string;
  card_last4: string | null;
  vehicle_id: string | null;
}

export type ScoredCandidate = FuelCardCandidate & { digits: string; unit: string | null };

export interface LinkVerdict {
  status: "linked" | "ambiguous" | "unconfirmed" | "no_candidate" | "unidentifiable";
  method: "pan_exact" | "pan_suffix" | "last4_unit" | null;
  /** Fuel-card IDs: the one chosen, or the several that could not be told apart. Never a PAN. */
  candidates: string[];
}

/** Unit numbers are free text on both sides — "716", " 716 ", "716 - SOLD" must not be three units. */
export function normalizeUnit(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim().toUpperCase();
  if (!trimmed) return null;
  // Everything up to the first separator: the fleet writes "183 - SOLD" and "204/spare" in this field.
  const head = trimmed.split(/[^A-Z0-9]/)[0] ?? "";
  return head || null;
}

/**
 * The three tiers, in order, first unique hit wins.
 *
 * Separated from the loop so each tier can be tested against a fixture without a database, which is
 * what Step 7.7's Verify asks for: "two cards sharing a last-4 link each to the right fuel card, or
 * link neither and say why — never the wrong one."
 */
export function matchOneCard(
  env: Env,
  orgId: string,
  row: UnlinkedCard,
  pool: readonly ScoredCandidate[],
): LinkVerdict {
  const pan = unsealCardNumber(env, orgId, row.card_number_sealed);
  const panDigits = pan ? cardDigits(pan) : "";

  if (panDigits.length >= FULL_PAN_MIN_DIGITS) {
    const exact = pool.filter((c) => c.digits === panDigits);
    if (exact.length === 1) return { status: "linked", method: "pan_exact", candidates: [exact[0]!.id] };
    if (exact.length > 1) return { status: "ambiguous", method: null, candidates: exact.map((c) => c.id) };

    // Suffix, both sides full-length. NOT a last-4 fallback: the shorter side must itself be a full
    // card number, so this cannot fire on four digits however the data is shaped.
    const suffix = pool.filter(
      (c) =>
        c.digits.length >= FULL_PAN_MIN_DIGITS &&
        (c.digits.endsWith(panDigits) || panDigits.endsWith(c.digits)),
    );
    if (suffix.length === 1) return { status: "linked", method: "pan_suffix", candidates: [suffix[0]!.id] };
    if (suffix.length > 1) return { status: "ambiguous", method: null, candidates: suffix.map((c) => c.id) };
  }

  const last4 = row.card_last4;
  // Nothing at all to say. Distinct from every case below, because those all have a last-4 to reason
  // about and this one does not — the mirror row itself is the thing to fix.
  if (!last4) return { status: "unidentifiable", method: null, candidates: [] };

  const unit = normalizeUnit(row.unit_prompt);
  if (unit) {
    const byUnit = pool.filter((c) => c.digits.slice(-4) === last4 && c.unit === unit);
    if (byUnit.length === 1) return { status: "linked", method: "last4_unit", candidates: [byUnit[0]!.id] };
    // Two cards sharing a last-4 ON THE SAME UNIT are still refused. The unit is a discriminator, not
    // a tie-breaker of last resort.
    if (byUnit.length > 1) return { status: "ambiguous", method: null, candidates: byUnit.map((c) => c.id) };
  }

  /**
   * No tier could prove it. What remains is which fuel cards share this last-4, and the THREE
   * outcomes are deliberately separate because each sends somebody to a different place:
   *
   *   none  -> `no_candidate`  the fuel_cards row is missing; import it
   *   one   -> `unconfirmed`   there is a likely partner, but a last-4 is not identity and this
   *                            linker does not guess. A person can confirm it; the sweep will not.
   *   many  -> `ambiguous`     genuinely indistinguishable; give the card a unit prompt, or import
   *                            full PANs, and the next sweep resolves it.
   *
   * Collapsing `unconfirmed` into `no_candidate` would tell an operator nothing is there when
   * something probably is; collapsing it into `ambiguous` would claim a conflict that does not
   * exist. Both readings send them to the wrong screen.
   */
  const siblings = pool.filter((c) => c.digits.slice(-4) === last4);
  const status = siblings.length === 0 ? "no_candidate" : siblings.length === 1 ? "unconfirmed" : "ambiguous";
  return { status, method: null, candidates: siblings.map((c) => c.id) };
}

/**
 * Never throws. A row whose PAN cannot be unsealed — key rotated, ciphertext damaged — must degrade
 * to the weaker tiers rather than abort the sweep for every other card. The same shape of mistake as
 * the config scanner's `parseXml`, which throws where the caller expected null.
 */
function unsealCardNumber(env: Env, orgId: string, sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return open(env, sealed, secretAad(orgId, "efs_card_pan"));
  } catch {
    return null;
  }
}
