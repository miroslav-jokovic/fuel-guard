import { adBriefSchema, type AdBrief, type AdClaim } from "../../ads/contracts.js";
import { promiseTermOf } from "../../ads/adClaims.js";
import type { HiringRequirements } from "./hiringProfile.js";
import { factClaims, type OpeningFacts } from "./opening.js";
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
 *     the copy simply cannot promise it, which is the safe direction — it reaches the copy as subject matter;
 *   · the bonus, the ticked benefits, and any figure a person typed into home time or lanes ("Out 2 weeks, home 4
 *     days" → 2 weeks, 4 days) (CQ2, D-AD20) — `factClaims`, shared with the editor's own-words check.
 * Equipment, schedule, lanes and the carrier's line are the copy's SUBJECT MATTER (`openingSubjectMatter`),
 * not promises; they are not claims. Before CQ2 none of them reached the copywriter at all (G-CQ4).
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

/** The plain words for an equipment key and a schedule, for the subject matter (the copy's language is the model's). */
const EQUIPMENT_WORDS: Record<OpeningFacts["equipment"][number], string> = {
  dry_van: "dry van", reefer: "reefer", flatbed: "flatbed", tanker: "tanker", intermodal: "intermodal",
};
const SCHEDULE_WORDS: Record<NonNullable<OpeningFacts["schedule"]>, string> = {
  otr: "over-the-road runs", regional: "regional runs", local: "local runs",
};

/**
 * What the job is like, as phrases that claim nothing (CQ2, D-AD20): the equipment, the schedule, the lanes, and
 * home time as a person typed it when it is NOT a listed term (a listed term is a claim instead). The copywriter
 * reads these as subject matter; the art director as the scene. No figure is ever put here — a lane with a
 * number in it is still checked by `checkClaims` when the copy repeats it.
 */
export function openingSubjectMatter(facts: OpeningFacts): AdBrief["subject_matter"] {
  const details: string[] = [];
  details.push(`${facts.equipment.map((e) => EQUIPMENT_WORDS[e]).join(" and ")} freight`);
  if (facts.schedule) details.push(SCHEDULE_WORDS[facts.schedule]);
  // The typed phrases go in AS TYPED (no "lanes:" label): the copy may repeat a detail word for word, and
  // `judgeCopy` takes each detail as a phrase the brief vouches for — so "Out 10 to 12 days, home 3" may be said
  // exactly as the person wrote it, while a "3" on its own is still a figure nobody can account for.
  if (facts.lanes) details.push(facts.lanes);
  if (!promiseTermOf(facts.home_time)) details.push(facts.home_time);
  return { details: details.slice(0, 12), in_our_words: facts.in_our_words ?? null };
}

export function openingBrief(o: OpeningForBrief, req: HiringRequirements): AdBrief {
  const claims: AdClaim[] = factClaims(o.facts);
  claims.push({ kind: "quantity", value: req.min_age.years, unit: "age" });
  if (req.min_class_a_years.years > 0) claims.push({ kind: "quantity", value: req.min_class_a_years.years, unit: "year" });

  const form_questions = ["class_a_held"];
  if (req.min_class_a_years.years > 0) form_questions.push("class_a_years");
  if (req.hazmat.mode === "required") form_questions.push("hazmat_endorsement");

  // Parsed, not cast: a brief that does not meet the ads contract is refused here, not at compose.
  return adBriefSchema.parse({
    source: OPENING_BRIEF_SOURCE,
    ref: openingBriefRef(o.opening_id, o.version),
    subject: o.title,
    claims,
    subject_matter: openingSubjectMatter(o.facts),
    area: o.area,
    form_questions,
    landing_url: null,
  });
}
