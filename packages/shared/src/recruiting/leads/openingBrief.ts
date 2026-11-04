import { adBriefSchema, type AdBrief, type AdClaim } from "../../ads/contracts.js";
import { promiseTermOf } from "../../ads/adClaims.js";
import type { HiringRequirements } from "./hiringProfile.js";
import type { OpeningFacts } from "./opening.js";
import { OPENING_BRIEF_SOURCE } from "./leadContract.js";

/**
 * An opening as an ad brief (D-AD17; ADS-AGENT-BUILD-WORKFLOW S1b). Pure: one opening version and the
 * hiring-profile version it names in, the `AdBrief` the ads module freezes out. Recruiting's
 * `AdBriefSource` (apps/api `recruiting/leads/adBriefSource.ts`) reads the two rows and calls this.
 *
 * ── WHAT AN AD MAY CLAIM, AND WHY ONLY THIS ──────────────────────────────────────────────────────
 * The brief's claims are the ONLY figures and promises the claim checker lets copy state (D-AD1), so
 * every claim here is a fact a person saved on the opening or its profile, never one inferred:
 *   · pay — the opening's range, in cents, per its basis: the bottom always, the top when there is one;
 *   · minimum age — the profile's floor, as a quantity in years of age. The plan (§1, "Meta employment
 *     rules") has the ad say "must be 23 or older" in words because the form may not ask it, and the
 *     checker refuses that "23" unless the brief holds it;
 *   · years of Class A — the profile's floor when it is above zero;
 *   · home time — a promise TERM only when the text a person typed IS one of `PROMISE_TERMS`' phrasings
 *     ("Home weekly"). Anything else ("Out 2 weeks, home 3 days") is not turned into a term by guessing;
 *     the copy simply cannot promise it, which is the safe direction.
 * Equipment and lanes are the copy's subject matter, not promises; they are not claims.
 *
 * The form asks only what the profile requires and the G12 catalogue allows (`metaLeadForm.ts`):
 * Class A always (the profile always requires it), years only when there is a floor, the hazmat
 * endorsement only when the profile requires it.
 *
 * `landing_url` is null: Stage 1 ads collect through the platform's own form (plan §4.2).
 */

export interface OpeningForBrief {
  opening_id: string;
  version: number;
  title: string;
  facts: OpeningFacts;
  area: AdBrief["area"];
}

/** `<opening id>@v<version>` — the ref `openingOfBrief` reads back (leadContract.ts). */
export const openingBriefRef = (openingId: string, version: number) => `${openingId}@v${version}`;

export function openingBrief(o: OpeningForBrief, req: HiringRequirements): AdBrief {
  const claims: AdClaim[] = [{ kind: "money", cents: o.facts.pay.min_cents, per: o.facts.pay.per }];
  if (o.facts.pay.max_cents !== null && o.facts.pay.max_cents !== o.facts.pay.min_cents) {
    claims.push({ kind: "money", cents: o.facts.pay.max_cents, per: o.facts.pay.per });
  }
  claims.push({ kind: "quantity", value: req.min_age.years, unit: "age" });
  if (req.min_class_a_years.years > 0) claims.push({ kind: "quantity", value: req.min_class_a_years.years, unit: "year" });
  const term = promiseTermOf(o.facts.home_time);
  if (term) claims.push({ kind: "term", term });

  const form_questions = ["class_a_held"];
  if (req.min_class_a_years.years > 0) form_questions.push("class_a_years");
  if (req.hazmat.mode === "required") form_questions.push("hazmat_endorsement");

  // Parsed, not cast: a brief that does not meet the ads contract is refused here, not at compose.
  return adBriefSchema.parse({
    source: OPENING_BRIEF_SOURCE,
    ref: openingBriefRef(o.opening_id, o.version),
    subject: o.title,
    claims,
    area: o.area,
    form_questions,
    landing_url: null,
  });
}
