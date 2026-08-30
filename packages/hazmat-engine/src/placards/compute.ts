/**
 * computePlacards (plan H2) — the substantive §172.504 placarding ladder, fuel scope.
 *
 * Runs the Appendix-E gate ORDER (HM present → 1,001-lb weight → LQ → bulk ID display → sole-vs-mixed
 * → marine/HOT) but the VERDICTS come from the CFR (D1): §172.504 Table 1/Table 2, §172.504(b)/(c),
 * §172.302/172.331, §172.542(c)/172.544(c), §172.325. The engine is pure and cannot import @hazmat/data,
 * so it reads the dataset through a minimal consumer view (`DsView`) off the loose `load.dataset`.
 *
 * Safety posture (D2/D4): never fabricate and never UNDER-placard. An unresolvable line, a class the
 * fuel scope doesn't cover, or an ambiguous class → the determination is WITHHELD (no required placards
 * asserted + a conditional finding), never a guess. Unknown aggregate weight → placard conservatively
 * and flag it.
 *
 * Reconciliation flags (Appendix E.3 — resolve WITH the SME before hard-encoding):
 *   R1 (gross > 8,800 lb → ID number): NOT ENCODED — no standard §172.504 basis. Left out on purpose.
 *   R2 (sole-vs-mixed "worded placard" direction): the STANDARD CFR reading is used (a sole product →
 *       its specific placard; ≥2 Table-2 categories → DANGEROUS may replace the specifics) and flagged.
 *   R3 (the "is it bulk?" footnote): the standard §171.8 bulk trigger is used for ID display and flagged.
 */

import type { Finding, LoadInput, PlacardName, TraceNode } from "../types.js";
import { emptyPlacards } from "../types.js";
import { baseClass, DANGEROUS_CATEGORY_BAR_LB, readDataset, subsidiary505 } from "./classify.js";
import { ID_NUMBER_PROHIBITED_PLACARDS, planIdDisplay, type PlacardComputation, type Resolved, withheld } from "./computeSupport.js";
import { addSubsidiaryPlacards, finalizePlacards } from "./computeFinalize.js";
import { applyMarinePollutantMark } from "./marinePollutant.js";
import { resolvePlacardLines } from "./resolve.js";

export function computePlacards(load: LoadInput): PlacardComputation {
  const ds = readDataset(load);
  const placards = emptyPlacards();
  const findings: Finding[] = [];
  const trace: TraceNode[] = [];

  if (ds.placards.length === 0 || ds.entries.length === 0) {
    trace.push({ ruleId: "placard_dataset_present", fired: false, inputs: { entries: ds.entries.length, placards: ds.placards.length }, citations: [] });
    findings.push(withheld("The dataset has no HMT/placard tables loaded", { version: ds.version }));
    return { placards, findings, trace };
  }

  const resolution = resolvePlacardLines(load, ds, placards, findings, trace);
  const { resolved, table1Hits, explosivesHits } = resolution;
  if (!resolution.complete) return { placards, findings, trace };

  // Table 1 gate verdict (D4-revised): any Table 1 line blocks the WHOLE load — no placards computed, a
  // `violation` finding (→ eligibility forced `blocked` in evaluateLoad). "We don't cover this — do not rely on
  // the tool" is the only allowed answer; silence or a partial placard set on a Table 1 load is forbidden.
  if (table1Hits.length > 0) {
    const classes = [...new Set(table1Hits.map((h) => h.classOrDivision))];
    findings.push({
      ruleId: "table1_out_of_scope_v1",
      tier: "violation",
      message:
        `This load contains a 49 CFR 172.504 Table 1 material (${classes.join(", ")}), which is outside ` +
        `HazmatGuard's v1 scope. Placards cannot be computed and the load cannot be cleared — route it to a ` +
        `hazmat-trained reviewer; do not rely on the tool for this load.`,
      citations: [{ cfr: "49 CFR 172.504" }, { cfr: "internal: Table 1 out of scope (plan D4-revised / D2)" }],
      evidence: { table1Classes: classes, lines: table1Hits.map((h) => h.hmtRef) },
    });
    trace.push({ ruleId: "table1_out_of_scope_v1", fired: true, inputs: { table1Classes: classes, count: table1Hits.length }, citations: [{ cfr: "49 CFR 172.504" }], note: "Table 1 recognized and blocked; no placards computed for the load." });
    return { placards, findings, trace };
  }

  // Explosives verdict — same posture as Table 1: whole load blocked, nothing computed, said plainly.
  if (explosivesHits.length > 0) {
    const classes = [...new Set(explosivesHits.map((h) => h.classOrDivision))];
    findings.push({
      ruleId: "explosives_out_of_scope_v1",
      tier: "violation",
      message:
        `This load contains an explosives material (${classes.join(", ")}). Explosives placarding depends on ` +
        `compatibility groups and exception rules HazmatGuard does not yet evaluate, so no placards are computed ` +
        `and the load cannot be cleared — route it to a hazmat-trained reviewer; do not rely on the tool for this load.`,
      citations: [{ cfr: "49 CFR 172.504" }, { cfr: "internal: explosives out of scope (plan D4-revised / D2)" }],
      evidence: { explosivesClasses: classes, lines: explosivesHits.map((h) => h.hmtRef) },
    });
    trace.push({ ruleId: "explosives_out_of_scope_v1", fired: true, inputs: { explosivesClasses: classes, count: explosivesHits.length }, citations: [{ cfr: "49 CFR 172.504" }], note: "Explosives recognized and blocked; no placards computed for the load." });
    return { placards, findings, trace };
  }

  if (resolved.length === 0) {
    trace.push({ ruleId: "any_placardable_line", fired: false, inputs: {}, citations: [] });
    // §172.322 still has to run. A load whose every line takes NO placard is not a quiet load — it is
    // the one case where the MARINE POLLUTANT mark is unambiguously required in domestic highway
    // service, because §172.322(d)(3) waives the mark only for a vehicle that already bears a placard
    // or label. Returning here without asking was the difference between "nothing to display" and
    // "a mark on each side and each end".
    applyMarinePollutantMark({ load, ds, recognized: resolution.recognized, placards, anyPlacardOrLabel: false, findings, trace });
    return { placards, findings, trace }; // recognized, none placardable → no placards beyond any mark
  }

  // ── 2) §172.504(c) — the aggregate, and what it does NOT govern ───────────────────────────────
  // The 1,001 lb threshold applies to NON-BULK Table 2 material only. Three exclusions, each with its
  // own reason, and every one of them was missing: the code summed all Table 2 lines regardless.
  //
  //   · BULK placards at any quantity. A cargo tank IS bulk packaging, so a tanker under 1,001 lb used
  //     to come back with NO placards — the most dangerous output this function could produce.
  //   · RESIDUE-only non-bulk lines are excluded from the aggregate (§172.504(d), §173.29(c)).
  //   · §172.505 subsidiary materials placard regardless of the aggregate.
  const isTank = load.vehicle.kind === "cargo_tank";
  // H-LQ: an ACCEPTED Limited Quantity line is excepted from this entire subpart (§172.500(b)(2)) —
  // it leaves the Table 2 processing here (no placard requirement, no §172.504(c) aggregate, no
  // DANGEROUS category). Refused claims kept `lqAccepted: false` and stay fully regulated. LQ lines
  // still receive ERG guides and the HOT check below, and they deliberately REMAIN in the
  // §172.301(a)(3) marking aggregate — that is subpart D, not F, and keeping them can only
  // over-display (safe direction).
  const table2 = resolved.filter((r) => r.spec.table === 2 && !r.lqAccepted); // Table 1 already gated out above
  const isBulk = (r: Resolved): boolean => r.line.packagingKind === "bulk" || isTank;
  const has505 = (r: Resolved): boolean => subsidiary505(r.entry).pih || subsidiary505(r.entry).dww;

  const alwaysPlacard = table2.filter((r) => isBulk(r) || has505(r));
  const counted = table2.filter((r) => !isBulk(r) && !has505(r) && !r.line.isResidueLine);
  const excludedResidue = table2.filter((r) => !isBulk(r) && !has505(r) && r.line.isResidueLine);

  const weights = counted.map((r) => r.line.grossWeightLb);
  const weightKnown = weights.every((w) => w != null);
  const aggregateLb = weights.reduce<number>((s, w) => s + (w ?? 0), 0);
  const thresholdMet = counted.length === 0 ? false : !weightKnown || aggregateLb >= 1001;

  // H-P1 (0.9.0): the declared package count (§172.202(a)(7) — every shipping paper states one) is
  // read into the aggregate's evidence. It does not change the §172.504(c) arithmetic — the CFR
  // thresholds are weights, not counts — but it is part of what a reviewer checks the weight against,
  // so it belongs in the record rather than in the "accepted and ignored" list.
  const packageCounts = counted.map((r) => r.line.packageCount);
  const packageCountKnown = packageCounts.every((c) => c != null);
  const totalPackages = packageCountKnown ? packageCounts.reduce<number>((s, c) => s + (c ?? 0), 0) : null;

  trace.push({
    ruleId: "weight_threshold_1001lb",
    fired: true,
    inputs: {
      aggregateLb: weightKnown ? aggregateLb : null,
      countedLines: counted.length,
      countedPackages: totalPackages,
      alwaysPlacardLines: alwaysPlacard.length,
      residueExcluded: excludedResidue.length,
      thresholdMet,
    },
    citations: [{ cfr: "49 CFR 172.504(c)" }, { cfr: "49 CFR 172.504(d)" }, { cfr: "49 CFR 173.29(c)" }],
    note: weightKnown ? undefined : "aggregate weight unknown → placarding conservatively",
  });

  if (!weightKnown && counted.length > 0) {
    findings.push({
      ruleId: "aggregate_weight_unknown",
      tier: "conditional",
      message: "Aggregate gross weight is unknown, so the 1,001-lb (§172.504(c)) exception cannot be applied — placards are asserted conservatively. Confirm the weight.",
      citations: [{ cfr: "49 CFR 172.504(c)" }],
      evidence: { countedLines: counted.length },
    });
  }
  if (alwaysPlacard.length > 0) {
    findings.push({
      ruleId: "bulk_placards_regardless_of_weight",
      tier: "info",
      message: isTank
        ? "This is a cargo tank, which is bulk packaging — the 1,001-lb aggregate does not apply and these placards are required at any quantity (§172.504(c))."
        : `${alwaysPlacard.length} line(s) are bulk or carry a §172.505 subsidiary hazard — they placard regardless of the aggregate.`,
      citations: [{ cfr: "49 CFR 172.504(c)" }, { cfr: "49 CFR 172.505" }],
      evidence: { lines: alwaysPlacard.length, isTank },
    });
  }
  if (excludedResidue.length > 0) {
    findings.push({
      ruleId: "residue_excluded_from_aggregate",
      tier: "info",
      message: `${excludedResidue.length} residue-only line(s) are excluded from the 1,001-lb aggregate (§172.504(d), §173.29(c)).`,
      citations: [{ cfr: "49 CFR 172.504(d)" }, { cfr: "49 CFR 173.29(c)" }],
      evidence: { lines: excludedResidue.length },
    });
  }
  placards.aggregate = {
    countedLines: counted.length,
    countedPackages: totalPackages,
    countedGrossWeightLb: weightKnown ? aggregateLb : null,
    thresholdMet,
    alwaysPlacardLines: alwaysPlacard.length,
    residueExcludedLines: excludedResidue.length,
    thresholds: { placardLb: 1001, dangerousCategoryLb: DANGEROUS_CATEGORY_BAR_LB, nonBulkIdDisplayLb: 8820 },
  };

  // ── 2b) the load profile, stated (0.11.0 / H-MX) ──────────────────────────────────────────────
  // Bulk / non-bulk / mixed is a fact the engine already knows line by line; saying it once here means
  // the UI (and the record) never re-derives it. `otherFreightAboard` is echoed so a mixed
  // hazmat + general-freight load is describable — it feeds §172.301(a)(3) below and NOTHING else.
  const bulkResolvedCount = resolved.filter((r) => isBulk(r)).length;
  placards.loadProfile = {
    packaging: bulkResolvedCount === resolved.length ? "bulk" : bulkResolvedCount === 0 ? "non_bulk" : "mixed",
    hazmatLines: resolved.length,
    distinctPlacardCategories: new Set(resolved.map((r) => r.placard)).size,
    otherFreightAboard: load.otherFreightAboard,
  };

  // H-P1 follow-up: the package count was recorded and never questioned. "Count packages, not pallets"
  // was a form hint with nothing behind it, so a line reading 22 pallets instead of 1,056 boxes passed
  // silently — and the per-package gross it implies is the one number that catches it. A non-bulk
  // package cannot plausibly gross more than a §171.8 non-bulk receptacle can hold, so a per-package
  // gross above 882 lb (400 kg) means either the count is unitization or the packaging is really bulk.
  // Conditional, not a verdict: the engine asks, it does not overrule the paper.
  for (const r of counted) {
    const count = r.line.packageCount;
    const gross = r.line.grossWeightLb;
    if (count == null || count <= 0 || gross == null) continue;
    const perPackageLb = gross / count;
    if (perPackageLb <= 882) continue;
    findings.push({
      ruleId: "package_count_implausible_for_non_bulk",
      tier: "conditional",
      message:
        `${r.entry.psnPrinted}: ${count} non-bulk package(s) against ${Math.round(gross)} lb gross is ${Math.round(perPackageLb)} lb per package. ` +
        "A non-bulk receptacle tops out near the §171.8 limits, so either the count is pallets/units rather than DOT packages (§172.202(a)(7) states packages), " +
        "or this line is bulk packaging and must placard at any quantity. Confirm the count and the packaging before relying on the aggregate.",
      citations: [{ cfr: "49 CFR 172.202(a)(7)" }, { cfr: "49 CFR 171.8" }, { cfr: "49 CFR 172.504(c)" }],
      evidence: { hmtRef: r.line.hmtRef, packageCount: count, grossWeightLb: gross, perPackageLb: Math.round(perPackageLb) },
    });
    trace.push({
      ruleId: "package_count_plausibility",
      fired: true,
      inputs: { hmtRef: r.line.hmtRef, packageCount: count, grossWeightLb: gross, perPackageLb: Math.round(perPackageLb) },
      citations: [{ cfr: "49 CFR 172.202(a)(7)" }, { cfr: "49 CFR 171.8" }],
      note: "Per-package gross exceeds what a non-bulk receptacle plausibly holds.",
    });
  }

  if (counted.length > 0 && weightKnown && !thresholdMet) {
    findings.push({
      ruleId: "below_1001lb_no_placard",
      tier: "info",
      message: `Non-bulk Table-2 aggregate is ${aggregateLb} lb (< 1,001 lb), so those placards are not required — they remain permitted if you choose to display them (§172.502(c)).`,
      citations: [{ cfr: "49 CFR 172.504(c)" }, { cfr: "49 CFR 172.502(c)" }],
      evidence: { aggregateLb },
    });
  }

  // ── 3) categories, deduped by placard name ────────────────────────────────────────────────────
  const requiring: Resolved[] = [...alwaysPlacard, ...(thresholdMet ? counted : [])];
  const distinct = new Map<PlacardName, Resolved[]>();
  for (const r of requiring) {
    const arr = distinct.get(r.placard) ?? [];
    arr.push(r);
    distinct.set(r.placard, arr);
  }
  for (const placard of distinct.keys()) {
    placards.required.push({ placard, positions: "each_side_and_each_end", because: [{ cfr: "49 CFR 172.504(a)" }] });
  }

  // Sub-threshold categories are PERMITTED, not absent (§172.502(c)).
  if (!thresholdMet) {
    for (const placard of new Set(counted.map((r) => r.placard))) {
      if (!distinct.has(placard)) {
        placards.permitted.push({ placard, because: [{ cfr: "49 CFR 172.502(c)" }] });
      }
    }
  }

  const subsidiaryPlacards = addSubsidiaryPlacards(placards, trace, table2);

  // ── 4) §172.504(b) DANGEROUS — three restrictions, none of which existed ──────────────────────
  // It was offered on any load with two Table 2 categories, including a cargo tank, where the rule is
  // a hard block. The 2,205 lb bar and the non-bulk-only limit were a comment string.
  const nonBulkRequiring = requiring.filter((r) => !isBulk(r) && !has505(r));
  const nonBulkCategories = new Map<PlacardName, Resolved[]>();
  for (const r of nonBulkRequiring) {
    const arr = nonBulkCategories.get(r.placard) ?? [];
    arr.push(r);
    nonBulkCategories.set(r.placard, arr);
  }

  if (isTank) {
    placards.prohibited.push({ placard: "DANGEROUS", because: [{ cfr: "49 CFR 172.504(b)" }] });
    trace.push({
      ruleId: "dangerous_prohibited_on_bulk",
      fired: true,
      inputs: { isTank },
      citations: [{ cfr: "49 CFR 172.504(b)" }],
      note: "DANGEROUS is a non-bulk substitution; a cargo tank is bulk packaging.",
    });
  } else if (nonBulkCategories.size >= 2) {
    // A category with ≥2,205 lb loaded at one facility keeps its own placard (§172.504(b)). Unknown
    // weight is treated as over the bar: the substitution is optional, so withholding it is safe.
    const substitutable = [...nonBulkCategories.entries()].filter(([, rs]) => {
      const known = rs.every((r) => r.line.grossWeightLb != null);
      const lb = rs.reduce<number>((sum, r) => sum + (r.line.grossWeightLb ?? 0), 0);
      return known && lb < DANGEROUS_CATEGORY_BAR_LB;
    });
    if (substitutable.length >= 2) {
      for (const [placard] of substitutable) {
        placards.optionalSubstitutions.push({ instead: placard, use: "DANGEROUS", because: [{ cfr: "49 CFR 172.504(b)" }] });
      }
    }
    trace.push({
      ruleId: "mixed_load_dangerous_option",
      fired: substitutable.length >= 2,
      inputs: { nonBulkCategories: nonBulkCategories.size, substitutable: substitutable.length, barLb: DANGEROUS_CATEGORY_BAR_LB },
      citations: [{ cfr: "49 CFR 172.504(b)" }],
      note:
        substitutable.length >= 2
          ? "≥2 non-bulk Table-2 categories, each under 2,205 lb at one facility — one DANGEROUS placard may replace them."
          : "Not offered: fewer than two categories qualify once the 2,205-lb single-category bar is applied.",
    });
  }

  // 5) §172.542(c)/172.544(c) fuel wording — GASOLINE for gasoline, FUEL OIL for fuel oil (highway tank)
  for (const [placard, rs] of distinct) {
    const opts = rs[0]?.spec.wordingOptions ?? [];
    if (!isTank || opts.length === 0) continue;
    if (placard === "FLAMMABLE" && rs.some((r) => r.entry.idNumber === "1203") && opts.includes("GASOLINE")) {
      placards.optionalSubstitutions.push({ instead: "FLAMMABLE", use: "GASOLINE", because: [{ cfr: "49 CFR 172.542(c)" }] });
    }
    if (placard === "COMBUSTIBLE" && rs.some((r) => /fuel oil/i.test(r.entry.psnPrinted)) && opts.includes("FUEL OIL")) {
      placards.optionalSubstitutions.push({ instead: "COMBUSTIBLE", use: "FUEL_OIL", because: [{ cfr: "49 CFR 172.544(c)" }] });
    }
  }

  // The placards an identification number may be displayed ACROSS on this load (§172.332(c)), after
  // §172.334 removes the barred designs and anything §172.505 raised for a subsidiary hazard.
  const idCarrierPlacards = placards.required
    .map((p) => p.placard)
    .filter((p) => !subsidiaryPlacards.has(p) && !ID_NUMBER_PROHIBITED_PLACARDS.has(p));
  const idPlan = planIdDisplay(idCarrierPlacards);

  // 6) §172.302(c)/172.331 ID-number display for bulk (R3: exact bulk trigger pending the SME footnote)
  const bulkLines = resolved.filter((r) => r.line.packagingKind === "bulk" || isTank);
  const seenId = new Set<string>();
  for (const r of bulkLines) {
    const idNumber = `${r.entry.idPrefix}${r.entry.idNumber}`;
    if (seenId.has(idNumber)) continue;
    seenId.add(idNumber);
    placards.idDisplays.push({
      idNumber,
      format: idPlan.format,
      alternateFormats: idPlan.alternateFormats,
      onPlacards: idPlan.onPlacards,
      positions: "each_side_and_each_end",
      because: [{ cfr: "49 CFR 172.302(c)" }, { cfr: "49 CFR 172.331" }],
    });
  }
  if (bulkLines.length > 0) {
    trace.push({
      ruleId: "bulk_id_display",
      fired: true,
      inputs: { ids: [...seenId] },
      citations: [{ cfr: "49 CFR 172.302(c)" }, { cfr: "49 CFR 172.331" }],
      note: "Multiple distillate fuels in one tank may display only the lowest-flash-point ID (PHMSA 18-0023/14-0178) — not yet applied. R3: confirm the bulk-definition footnote.",
    });
  }

  // 6b) §172.301(a)(3) (R1, resolved from the CFR + PHMSA Chart 15) — the NON-BULK case: a vehicle with
  //     ≥ 4,000 kg (8,820 lb) of a SINGLE material (same PSN + ID) in non-bulk packages, loaded at one
  //     facility, carrying no other material (hazardous or otherwise), and not Class 1/7, must display the
  //     ID number. The engine sees material + weight + packaging but NOT the loading facility or whether
  //     other freight is aboard, so it asserts the ID with a conditional naming those two assumptions —
  //     never under-marking. (Below the threshold, non-bulk needs no vehicle ID display.)
  const nonBulk = resolved.filter((r) => r.line.packagingKind === "non_bulk" && !isTank);
  const nbIds = new Set(nonBulk.map((r) => `${r.entry.idPrefix}${r.entry.idNumber}`));
  const nbWeights = nonBulk.map((r) => r.line.grossWeightLb);
  const nbWeightKnown = nbWeights.every((w) => w != null);
  const nbAggregateLb = nbWeights.reduce<number>((s, w) => s + (w ?? 0), 0);
  const NONBULK_ID_THRESHOLD_LB = 8820; // 4,000 kg — the metric figure is the operative one (§172.301(a)(3))
  const notClass1or7 = nonBulk.every((r) => !/^1(\.|$)|^7$/.test(baseClass(r.entry.hazardClass ?? "")));
  // 0.11.0 (H-MX): the rule's fourth condition — "contains no other material, hazardous or otherwise"
  // — is now actually evaluated. Other HAZMAT aboard (a bulk line, an LQ line, a second product) is
  // knowable from the lines themselves; other NON-hazmat freight is the `otherFreightAboard` input.
  //   · other hazmat aboard, or ≥2 non-bulk materials → the rule simply does not apply (as before);
  //   · otherFreightAboard === true  → the display is NOT required — said out loud, with the citation;
  //   · otherFreightAboard === false → required; only the one-loading-facility assumption remains;
  //   · otherFreightAboard === null  → asserted conservatively with both assumptions (pre-0.11 behavior).
  const otherHazmatAboard = resolved.length !== nonBulk.length;
  const singleMaterialLoad = nonBulk.length > 0 && nbIds.size === 1 && !otherHazmatAboard;
  const nbWeightTrigger = !nbWeightKnown || nbAggregateLb >= NONBULK_ID_THRESHOLD_LB;
  if (singleMaterialLoad && notClass1or7 && nbWeightTrigger) {
    const idNumber = [...nbIds][0] as string;
    if (load.otherFreightAboard === true) {
      findings.push({
        ruleId: "nonbulk_id_display_not_required_mixed_load",
        tier: "info",
        message:
          `The vehicle carries other freight, so the §172.301(a)(3) identification-number display for ${idNumber} is NOT required — ` +
          `that rule applies only when the vehicle contains no other material, hazardous or otherwise. ` +
          `The placarding answer above is unchanged (other freight never counts toward the §172.504(c) aggregate).`,
        citations: [{ cfr: "49 CFR 172.301(a)(3)" }],
        evidence: { aggregateLb: nbWeightKnown ? nbAggregateLb : null, idNumber, otherFreightAboard: true },
      });
      trace.push({
        ruleId: "nonbulk_id_display_172_301",
        fired: false,
        inputs: { aggregateLb: nbWeightKnown ? nbAggregateLb : null, singleMaterial: idNumber, otherFreightAboard: true },
        citations: [{ cfr: "49 CFR 172.301(a)(3)" }],
        note: "Not required: other freight is aboard, so the no-other-material condition fails.",
      });
    } else {
      const confirmedNoOtherFreight = load.otherFreightAboard === false;
      if (!seenId.has(idNumber)) {
        seenId.add(idNumber);
        placards.idDisplays.push({
          idNumber,
          format: idPlan.format,
          alternateFormats: idPlan.alternateFormats,
          onPlacards: idPlan.onPlacards,
          positions: "each_side_and_each_end",
          because: [{ cfr: "49 CFR 172.301(a)(3)" }, { cfr: "49 CFR 172.332" }, { cfr: "49 CFR 172.336" }],
        });
      }
      const nbPackageCounts = nonBulk.map((r) => r.line.packageCount);
      const nbPackages = nbPackageCounts.every((c) => c != null)
        ? nbPackageCounts.reduce<number>((s, c) => s + (c ?? 0), 0)
        : null;
      findings.push({
        ruleId: "nonbulk_single_material_id_display",
        tier: "conditional",
        message:
          `A single-material non-bulk load${nbWeightKnown ? ` of ${nbAggregateLb} lb` : ""} must display its identification number (${idNumber}) ` +
          `when it is ≥ 4,000 kg (8,820 lb), all loaded at one facility, and the vehicle carries no other material (§172.301(a)(3)). ` +
          (confirmedNoOtherFreight
            ? `No other freight is declared aboard — confirm the loading-facility condition.`
            : `Confirm the loading-facility and no-other-material conditions.`),
        citations: [{ cfr: "49 CFR 172.301(a)(3)" }],
        evidence: {
          aggregateLb: nbWeightKnown ? nbAggregateLb : null,
          packageCount: nbPackages,
          idNumber,
          otherFreightAboard: load.otherFreightAboard,
        },
      });
      trace.push({
        ruleId: "nonbulk_id_display_172_301",
        fired: true,
        inputs: {
          aggregateLb: nbWeightKnown ? nbAggregateLb : null,
          singleMaterial: idNumber,
          otherFreightAboard: load.otherFreightAboard,
        },
        citations: [{ cfr: "49 CFR 172.301(a)(3)" }],
        note: "R1 resolved: the 8,820 lb figure is the 4,000 kg non-bulk single-material trigger (PHMSA Chart 15).",
      });
    }
  }

  // 6c) §172.332 / §172.334 / §172.336 — HOW the required number is displayed.
  //
  // Previously the engine asserted `orange_panel` and said nothing else, which reads as "the orange
  // panel is the answer". It is one of three lawful presentations, and on a single-hazard load the
  // one carriers actually run is the number across the placard (§172.332(c)) — one diamond instead of
  // a worded diamond plus a separate panel. The other two stay on the record with their citations.
  if (placards.idDisplays.length > 0) {
    trace.push({
      ruleId: "id_display_format_172_332",
      fired: true,
      inputs: {
        recommended: idPlan.format,
        alternates: idPlan.alternateFormats.map((f) => f.format),
        carrierPlacards: idPlan.onPlacards,
        barredByS334: placards.required
          .map((p) => p.placard)
          .filter((p) => ID_NUMBER_PROHIBITED_PLACARDS.has(p) || subsidiaryPlacards.has(p)),
      },
      citations: [{ cfr: "49 CFR 172.332(b)" }, { cfr: "49 CFR 172.332(c)" }, { cfr: "49 CFR 172.334" }, { cfr: "49 CFR 172.336(b)" }],
      note:
        idPlan.onPlacards.length > 0
          ? "The number may be displayed across the placard itself; orange panel and white square-on-point remain available."
          : "Every required placard on this load is barred from carrying an identification number (§172.334) — the number needs its own orange panel or white square-on-point.",
    });

    // The §172.504(b) DANGEROUS substitution and a required ID display do not compose: DANGEROUS may
    // never carry a number (§172.334). A carrier that takes the substitution to save placards still
    // has to hang panels, and finding that out at the dock is exactly the kind of surprise this tool
    // exists to prevent — so it is said here, at the point the substitution is offered.
    if (placards.optionalSubstitutions.some((s) => s.use === "DANGEROUS")) {
      findings.push({
        ruleId: "dangerous_substitution_blocks_id_on_placard",
        tier: "info",
        message:
          "This load may substitute one DANGEROUS placard for its specific placards (§172.504(b)), but a DANGEROUS placard may not display an identification number (§172.334). " +
          `If you take the substitution, ${[...new Set(placards.idDisplays.map((d) => d.idNumber))].join(", ")} must go on orange panels or white square-on-point displays instead.`,
        citations: [{ cfr: "49 CFR 172.334" }, { cfr: "49 CFR 172.504(b)" }, { cfr: "49 CFR 172.332(b)" }],
        evidence: { ids: [...new Set(placards.idDisplays.map((d) => d.idNumber))] },
      });
    }
  }

  finalizePlacards({
    placards,
    findings,
    resolved,
    erg: ds.erg,
    provisional: ds.provisional,
    datasetVersion: ds.version,
  });

  // ── §172.322 — the MARINE POLLUTANT mark (0.12.0) ─────────────────────────────────────────────
  // LAST on purpose. §172.322(d)(3) waives the mark on a bulk packaging or vehicle "that bears a
  // label or placard specified in subparts E or F", so the exception cannot be evaluated until the
  // placard set is final — including the subsidiary placards `finalizePlacards` may have just added.
  //
  // `required.length > 0` is the subpart F half of that test and is the half that applies here:
  // subpart E labels go on PACKAGES (§172.400(a)), and the branch this feeds is the bulk one, where
  // the packaging is placarded or marked rather than labelled.
  applyMarinePollutantMark({
    load,
    ds,
    recognized: resolution.recognized,
    placards,
    anyPlacardOrLabel: placards.required.length > 0,
    findings,
    trace,
  });

  return { placards, findings, trace };
}
