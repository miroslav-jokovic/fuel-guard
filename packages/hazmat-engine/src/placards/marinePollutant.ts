import type { Citation, Finding, LoadInput, PlacardOutput, TraceNode } from "../types.js";
import type { DsEntry, DsView } from "./classify.js";

/**
 * §172.322 — the MARINE POLLUTANT mark (engine 0.12.0).
 *
 * The research this implements is `docs/plans/hazmat-consolidation/MARINE-POLLUTANT-RESEARCH.md`,
 * fetched verbatim from the eCFR versioner API rather than recalled. Two facts drive everything and
 * both are counterintuitive:
 *
 *  · §171.4(c)(1) — "Except when all or part of the transportation is by vessel, the requirements of
 *    this subchapter specific to marine pollutants do not apply to non-bulk packagings transported by
 *    motor vehicle, rail car or aircraft." A domestic truckload of non-bulk marine pollutant has NO
 *    marine-pollutant requirement at all. §172.322(a) says it from the other side by opening "For
 *    vessel transportation of each non-bulk packaging".
 *  · §172.322(d)(3) — "Except for transportation by vessel, on a bulk packaging, freight container or
 *    transport vehicle that bears a label or placard specified in subparts E or F of this part." A
 *    domestic bulk marine pollutant on an ALREADY-PLACARDED vehicle needs no mark. That is the common
 *    trucking case, and the naive "it is a marine pollutant, mark it" answer is wrong for it.
 *
 * So the mark is required domestically in one narrow band — BULK packaging on a vehicle carrying no
 * subpart E label and no subpart F placard — which is precisely the load a placarding tool would
 * otherwise hand back as "no placards required" with nothing else to say.
 *
 * It is a MARK, never a placard: it lands in `placards.marks` beside the §172.315 LQ mark, for the
 * same reason the verdict panel already says a white square-on-point "is not a placard (§172.336(b))".
 *
 * ⚠ The findings raised here are mostly `info`, and `evaluateLoad` keeps only `conditional` and
 * `violation` findings in `eligibility.blocks` — an info finding never leaves the engine. So the
 * user-facing outputs of this rule are the MARK itself (which the verdict panel renders, with its
 * positions and citations) and the TRACE note (which the panel discloses). The info findings are
 * written for the run record and for whoever later gives them a channel; nothing here relies on
 * them being displayed.
 */

/** Appendix B is matched on the printed name, the way `bol/validate.ts` already matches it. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The n.o.s. route, which name-matching can never catch.
 *
 * Appendix B lists SUBSTANCES — acrolein, aniline, bromoform. Measured against the shipped dataset,
 * 132 of 2,479 HMT entries match it by proper shipping name. The other route into a marine pollutant
 * is UN3077 / UN3082, "Environmentally hazardous substance, solid/liquid, n.o.s.", where the material
 * is a pollutant because of a COMPONENT that §172.322(a)(1) requires in parentheses — a component
 * this product does not collect, so no name match is possible or ever will be.
 *
 * Those two entries are recognised by identity instead, on the regulation's own words. Special
 * provision 441 (§172.102(c)(1)) opens: "For marine pollutants transported under 'UN3077,
 * Environmentally hazardous substance, solid, n.o.s.' or 'UN3082, Environmentally hazardous
 * substance, liquid, n.o.s.'…" — the CFR treats those descriptions as descriptions OF a marine
 * pollutant, which is exactly what declaring one asserts.
 *
 * Deliberately UN-only and name-checked. NA3077/NA3082 share the ID numbers but are "Hazardous
 * waste, n.o.s." and "Other regulated substances, n.o.s." — different entries that SP 441 does not
 * name, and a hazardous waste is not a marine pollutant by virtue of being a waste.
 */
export function isEnvironmentallyHazardousEntry(entry: { idPrefix?: string; idNumber?: string; psnPrinted?: string }): boolean {
  if (entry.idPrefix !== "UN") return false;
  if (entry.idNumber !== "3077" && entry.idNumber !== "3082") return false;
  return /^environmentally hazardous substance/i.test(entry.psnPrinted ?? "");
}

export interface MarinePollutantHit {
  hmtRef: string;
  psn: string;
  /** Appendix B's "PP" column; null on the SP-441 route, where the pollutant is an unnamed component. */
  severe: boolean | null;
  bulk: boolean;
  /** The stated §171.8 concentration by weight, when the offeror gave one. */
  concentrationPct: number | null;
}

/** A line that resolved to an HMT entry, whether or not it takes a placard. */
export interface RecognizedLine {
  line: { hmtRef: string; packagingKind?: string; marinePollutantConcentrationPct?: number | null };
  entry: DsEntry;
}

/**
 * Which resolved lines are marine pollutants. Name-matched against Appendix B; the §171.8
 * concentration test (10%, or 1% for a severe pollutant) is NOT evaluated because no input in this
 * product carries a concentration — the finding says so rather than the code assuming either way.
 */
/**
 * Is this HMT entry a marine pollutant, and how severe?
 *
 * ONE definition, exported, because there are now two callers — this rule and the products API that
 * decides whether the calculator even asks about concentration. Two definitions of "is this a marine
 * pollutant" would drift, and the one that drifted would be the one asking the user a question the
 * engine then ignored.
 *
 * `severe` is a TRI-STATE. Appendix B's "PP" column says severe or not; the SP-441 route knows only
 * that a pollutant is present, because the pollutant is a component nobody told us — so severity is
 * `null`, and §171.8's threshold then takes the STRICTER 1% figure. A lower threshold makes more
 * mixtures count as marine pollutants, which is the over-display direction.
 */
export function classifyMarinePollutantEntry(
  entry: { psnPrinted?: string; psnAlternates?: string[]; idPrefix?: string; idNumber?: string },
  marinePollutants: DsView["marinePollutants"],
): { listed: boolean; severe: boolean | null } {
  const names = [entry.psnPrinted, ...(entry.psnAlternates ?? [])]
    .filter((n): n is string => typeof n === "string")
    .map(norm);
  const match = marinePollutants.find((m) => names.includes(m.nameNormalized));
  if (match) return { listed: true, severe: match.severe === true };
  if (isEnvironmentallyHazardousEntry(entry)) return { listed: true, severe: null };
  return { listed: false, severe: false };
}

/**
 * §171.8's concentration threshold for a solution or mixture, as a percent by weight.
 *
 * Ten percent for a listed material, one percent for a severe one — and one percent when severity is
 * unknown, because that is the answer that classifies MORE loads as marine pollutants.
 */
export function concentrationThresholdPct(severe: boolean | null): number {
  return severe === false ? 10 : 1;
}

export function findMarinePollutants(recognized: RecognizedLine[], ds: DsView, isTank: boolean): MarinePollutantHit[] {
  // NO early return on an empty appendix B. The SP-441 identity route does not consult it, and a
  // guard here would have silently switched that route off for every dataset cut before appendix B
  // was imported — the exact shape of failure this file exists to avoid.
  const hits: MarinePollutantHit[] = [];
  for (const r of recognized) {
    const { listed, severe } = classifyMarinePollutantEntry(r.entry, ds.marinePollutants);
    if (!listed) continue;

    /**
     * §171.8's concentration test, now that there is an input for it (0.14.0).
     *
     * The clause is "when in a solution or mixture of one or more marine pollutants" — a NEAT listed
     * material is a marine pollutant with no arithmetic at all. So a stated concentration BELOW the
     * threshold is the only thing that can take a line out; a blank field still means "neat, or a
     * mixture nobody measured", and both of those stay in. Fail-closed by construction: the input can
     * only ever REMOVE a requirement when someone has actually stated the number.
     */
    const pct = r.line.marinePollutantConcentrationPct;
    if (typeof pct === "number" && pct < concentrationThresholdPct(severe)) continue;

    hits.push({
      hmtRef: r.line.hmtRef,
      psn: r.entry.psnPrinted,
      severe,
      bulk: r.line.packagingKind === "bulk" || isTank,
      concentrationPct: typeof pct === "number" ? pct : null,
    });
  }
  return hits;
}

const CITE_322B: Citation[] = [{ cfr: "49 CFR 172.322(b)" }, { cfr: "49 CFR 172.322(c)" }];
const CITE_322A: Citation[] = [{ cfr: "49 CFR 172.322(a)" }, { cfr: "49 CFR 172.322(c)" }];
const CITE_EXEMPT_NONBULK: Citation[] = [{ cfr: "49 CFR 171.4(c)(1)" }, { cfr: "49 CFR 172.322(a)" }];
const CITE_D3: Citation[] = [{ cfr: "49 CFR 172.322(d)(3)" }];

/**
 * What the finding says about §171.8, which now depends on whether anyone answered.
 *
 * Before 0.14.0 this was a standing apology on every marine-pollutant finding — "this tool has no
 * concentration input". It has one. When the number is stated the finding reports it; when it is not,
 * the caveat is narrowed to the case it actually applies to, a solution or mixture, because a NEAT
 * listed material is a marine pollutant with no arithmetic at all.
 */
function concentrationNote(hits: MarinePollutantHit[]): string {
  const stated = hits.filter((h) => h.concentrationPct != null);
  if (stated.length === hits.length && hits.length > 0) {
    const worst = Math.min(...hits.map((h) => concentrationThresholdPct(h.severe)));
    return `Stated at ${stated.map((h) => `${h.concentrationPct}%`).join(", ")} by weight, at or above the §171.8 threshold of ${worst}%.`;
  }
  return (
    "If any of this is a solution or mixture rather than the material itself, it is only a marine " +
    "pollutant at or above 10% by weight (1% for a severe marine pollutant, §171.8) — state the " +
    "concentration to have that applied."
  );
}

/**
 * Apply §172.322 to a resolved load. Mutates `placards.marks` and appends findings/trace the way the
 * rest of the ladder does.
 *
 * `anyPlacardOrLabel` is whether the vehicle bears a subpart E label or subpart F placard, which is
 * what §172.322(d)(3) turns on. The caller passes it AFTER the placard decision, because the
 * exception cannot be evaluated before the placards are known.
 */
export function applyMarinePollutantMark(args: {
  load: LoadInput;
  ds: DsView;
  recognized: RecognizedLine[];
  placards: PlacardOutput;
  anyPlacardOrLabel: boolean;
  findings: Finding[];
  trace: TraceNode[];
}): void {
  const { load, ds, recognized, placards, anyPlacardOrLabel, findings, trace } = args;
  const isTank = load.vehicle.kind === "cargo_tank";
  const hits = findMarinePollutants(recognized, ds, isTank);

  if (hits.length === 0) {
    trace.push({ ruleId: "marine_pollutant", fired: false, inputs: { appendixBLoaded: ds.marinePollutants.length }, citations: [{ cfr: "49 CFR 172.322" }] });
    return;
  }

  const vessel = load.portContext?.vesselConnected ?? null;
  const bulkHits = hits.filter((h) => h.bulk);
  const nonBulkHits = hits.filter((h) => !h.bulk);
  const evidence = { lines: hits.map((h) => ({ hmtRef: h.hmtRef, psn: h.psn, severe: h.severe, bulk: h.bulk })) };
  const names = hits.map((h) => h.psn).join(", ");

  /** The vehicle-level mark. §172.322(c) is "each side and each end" whatever the packaging size. */
  const requireMark = (because: Citation[]): void => {
    if (placards.marks.some((m) => m.mark === "MARINE_POLLUTANT")) return;
    placards.marks.push({
      mark: "MARINE_POLLUTANT",
      positions:
        "each side and each end of the transport vehicle — square-on-point, black fish-and-tree symbol " +
        "on white, at least 250 mm (9.8 in) per side; it may be displayed in black on a square-on-point " +
        "the same outside dimensions as a placard",
      because,
    });
  };

  // ── BULK ────────────────────────────────────────────────────────────────────────────────────────
  if (bulkHits.length > 0) {
    if (vessel === true || !anyPlacardOrLabel) {
      requireMark(vessel === true ? [...CITE_322B, { cfr: "49 CFR 171.4(c)(1)" }] : CITE_322B);
      findings.push({
        ruleId: "marine_pollutant_mark_required",
        tier: "info",
        message:
          `${names} is a listed marine pollutant (appendix B to §172.101) in BULK packaging, so the ` +
          `MARINE POLLUTANT mark is required on each side and each end of the vehicle (§172.322(b), (c)). ` +
          (anyPlacardOrLabel
            ? "The §172.322(d)(3) exception for an already-placarded vehicle does not apply, because part of this move is by vessel. "
            : "The §172.322(d)(3) exception does not apply, because this vehicle bears no subpart E label or subpart F placard. ") +
          concentrationNote(hits),
        citations: vessel === true ? [...CITE_322B, { cfr: "49 CFR 171.4(c)(1)" }] : [...CITE_322B, ...CITE_D3],
        evidence,
      });
      trace.push({ ruleId: "marine_pollutant", fired: true, inputs: { bulk: true, vessel, anyPlacardOrLabel, marked: true }, citations: CITE_322B, note: `MARINE POLLUTANT mark required — bulk ${names}. ${anyPlacardOrLabel ? "Vessel leg, so the §172.322(d)(3) placarded-vehicle exception does not apply." : "The vehicle bears no placard or label, so §172.322(d)(3) does not apply."}` });
    } else if (vessel === false) {
      findings.push({
        ruleId: "marine_pollutant_mark_not_required",
        tier: "info",
        message:
          `${names} is a listed marine pollutant in bulk packaging, but this vehicle already bears a ` +
          `placard or label, so no MARINE POLLUTANT mark is required for this domestic move (§172.322(d)(3)). ` +
          concentrationNote(hits),
        citations: CITE_D3,
        evidence,
      });
      trace.push({ ruleId: "marine_pollutant", fired: true, inputs: { bulk: true, vessel, anyPlacardOrLabel, marked: false }, citations: CITE_D3, note: `No MARINE POLLUTANT mark: ${names} is bulk, but this domestic vehicle already bears a placard or label (§172.322(d)(3)).` });
    } else {
      // vessel unknown AND the vehicle is placarded — the two branches disagree, so ask.
      findings.push({
        ruleId: "marine_pollutant_vessel_unknown",
        tier: "conditional",
        message:
          `${names} is a listed marine pollutant in bulk packaging. Whether the MARINE POLLUTANT mark is ` +
          `required turns on a fact this load has not stated: §172.322(d)(3) waives it for an ` +
          `already-placarded vehicle EXCEPT when any part of the transportation is by vessel. State whether ` +
          `this move has a vessel leg. ` + concentrationNote(hits),
        citations: [...CITE_D3, { cfr: "49 CFR 171.4(c)(1)" }],
        evidence,
      });
      trace.push({ ruleId: "marine_pollutant", fired: true, inputs: { bulk: true, vessel: null, anyPlacardOrLabel: true }, citations: CITE_D3, note: "vessel leg unstated — outcome differs between branches" });
    }
  }

  // ── NON-BULK ────────────────────────────────────────────────────────────────────────────────────
  if (nonBulkHits.length === 0) return;
  const nbNames = nonBulkHits.map((h) => h.psn).join(", ");
  const nbEvidence = { lines: nonBulkHits.map((h) => ({ hmtRef: h.hmtRef, psn: h.psn, severe: h.severe })) };

  if (vessel === false) {
    findings.push({
      ruleId: "marine_pollutant_not_applicable_nonbulk",
      tier: "info",
      message:
        `${nbNames} is a listed marine pollutant, but in NON-BULK packaging on a domestic highway move the ` +
        `marine-pollutant requirements do not apply at all (§171.4(c)(1)) — no mark, and nothing to display ` +
        `on the vehicle for it.`,
      citations: CITE_EXEMPT_NONBULK,
      evidence: nbEvidence,
    });
    trace.push({ ruleId: "marine_pollutant_nonbulk", fired: true, inputs: { vessel: false, marked: false }, citations: CITE_EXEMPT_NONBULK, note: `No marine-pollutant requirement: ${nbNames} is non-bulk on a domestic highway move (§171.4(c)(1)).` });
    return;
  }

  if (vessel === true) {
    requireMark(CITE_322A);
    findings.push({
      ruleId: "marine_pollutant_mark_required",
      tier: "info",
      message:
        `${nbNames} is a listed marine pollutant in non-bulk packaging and part of this move is by vessel, so ` +
        `§171.4(c)(1)'s highway exception does not apply: the MARINE POLLUTANT mark goes on each package in ` +
        `association with its labels (§172.322(a)) and on each side and each end of the vehicle (§172.322(c)). ` +
        `The §172.322(d)(1)/(d)(2) small-package exceptions (5 L / 5 kg per inner packaging) are NET quantities ` +
        `this tool does not collect — check them against the paper before omitting the mark. ` + concentrationNote(hits),
      citations: [...CITE_322A, { cfr: "49 CFR 172.322(d)(1)" }],
      evidence: nbEvidence,
    });
    trace.push({ ruleId: "marine_pollutant_nonbulk", fired: true, inputs: { vessel: true, marked: true }, citations: CITE_322A, note: `MARINE POLLUTANT mark required — ${nbNames} is non-bulk with a vessel leg, so §171.4(c)(1) does not except it.` });
    return;
  }

  findings.push({
    ruleId: "marine_pollutant_vessel_unknown",
    tier: "conditional",
    message:
      `${nbNames} is a listed marine pollutant in non-bulk packaging. On a highway-only move the ` +
      `marine-pollutant requirements do not apply to it at all (§171.4(c)(1)); if any part of the ` +
      `transportation is by vessel, the MARINE POLLUTANT mark is required on the packages and the vehicle ` +
      `(§172.322(a), (c)). State whether this move has a vessel leg. ` + concentrationNote(hits),
    citations: [...CITE_EXEMPT_NONBULK, { cfr: "49 CFR 172.322(c)" }],
    evidence: nbEvidence,
  });
  trace.push({ ruleId: "marine_pollutant_nonbulk", fired: true, inputs: { vessel: null }, citations: CITE_EXEMPT_NONBULK, note: "vessel leg unstated — outcome differs between branches" });
}
