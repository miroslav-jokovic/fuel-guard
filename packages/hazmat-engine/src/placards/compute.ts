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
import { pihRestsOnAbsence, selectPlacardRow } from "./tableSelect.js";
import {
  baseClass,
  DANGEROUS_CATEGORY_BAR_LB,
  effectiveClassKey,
  isExplosivesDivision,
  readDataset,
  subsidiary505,
  toPlacardName,
  pgRowForRef,
} from "./classify.js";
import {
  type PlacardComputation,
  type Resolved,
  verifyLqClaim,
  withheld,
} from "./computeSupport.js";

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

  // 1) resolve each line to its HMT entry + its placard category (fail closed on any miss)
  const resolved: Resolved[] = [];
  const table1Hits: { hmtRef: string; classOrDivision: string }[] = [];
  const explosivesHits: { hmtRef: string; classOrDivision: string }[] = [];
  for (const line of load.lines) {
    const [entryId] = line.hmtRef.split("#");
    const entry = ds.entries.find((e) => e.entryId === entryId);
    if (!entry) {
      findings.push(withheld(`Line "${line.hmtRef}" does not resolve to a dataset entry`, { hmtRef: line.hmtRef }));
      trace.push({ ruleId: "resolve_line", fired: false, inputs: { hmtRef: line.hmtRef }, citations: [] });
      return { placards, findings, trace };
    }
    const key = effectiveClassKey(entry, line.reclassedCombustible);
    const matches = ds.placards.filter((p) => baseClass(p.classOrDivision) === key);
    // Divisions 6.1 and 5.2 appear in BOTH tables, separated only by a qualifier the class number does
    // not carry. Decide it from the entry (see tableSelect.ts) instead of giving up — giving up is what
    // made every Class 6.1 material in the HMT return "withheld".
    const choice = selectPlacardRow(key, entry, matches);
    if (!choice.ok) {
      findings.push(withheld(choice.reason, { hmtRef: line.hmtRef, key, matched: matches.length, cfr: choice.citation }));
      trace.push({ ruleId: "class_to_placard", fired: false, inputs: { key, matched: matches.length }, citations: [{ cfr: choice.citation }], note: choice.reason });
      return { placards, findings, trace };
    }
    const spec = choice.spec;
    if (matches.length > 1) {
      trace.push({ ruleId: "placard_table_disambiguated", fired: true, inputs: { hmtRef: line.hmtRef, key, chosenTable: spec.table }, citations: [{ cfr: "49 CFR 172.102(c)(1)" }], note: choice.because });
    }
    // D2 — never under-placard. A non-PIH call made purely because no inhalation special provision is
    // present is a call about data the shipped table cannot fully evidence: it carries no hazard-zone
    // column. Compute the Table 2 placard, and refuse to let the load auto-clear on it.
    if (spec.table === 2 && pihRestsOnAbsence(key, entry)) {
      findings.push({
        ruleId: "pih_determination_from_special_provisions",
        tier: "conditional",
        message:
          `${entry.psnPrinted} is treated as NOT poisonous by inhalation because no §172.102 special provision 1–4 ` +
          "and no inhalation-hazard shipping name applies. A PIH material is a Table 1 material and must be " +
          "placarded in any quantity — confirm the classification on the shipping paper before relying on this.",
        citations: [{ cfr: "49 CFR 172.102(c)(1)" }, { cfr: "49 CFR 171.8" }],
        evidence: { hmtRef: line.hmtRef, entryId: entry.entryId },
      });
    }
    // 1b) Table 1 gate (D4-revised, D2 fail-closed): the fuel-scope engine RECOGNIZES 49 CFR 172.504 Table 1
    //     materials (explosives 1.1–1.3, 2.3 poison gas, 4.3, PIH 6.1, organic-peroxide 5.2, radioactive) from
    //     the dataset but does NOT compute their placards — Table 1 *logic* is a later expansion pack. Recognition
    //     is total and dataset-driven: capture any Table 1 row HERE (by its matched spec.table, regardless of
    //     whether its placard name maps to a known design) and block the whole load below.
    if (spec.table === 1) {
      table1Hits.push({ hmtRef: line.hmtRef, classOrDivision: spec.classOrDivision });
      trace.push({ ruleId: "table1_recognized", fired: true, inputs: { hmtRef: line.hmtRef, class: entry.hazardClass, classOrDivision: spec.classOrDivision }, citations: [{ cfr: "49 CFR 172.504" }], note: "Table 1 material — out of v1 scope (D4-revised)" });
      continue;
    }
    // Explosives gate (D4-revised). Divisions 1.4/1.5/1.6 genuinely ARE Table 2 rows — §172.504(e)
    // says so and the dataset is right to record it — but D4 defers explosives *logic*, and that
    // deferral is about depth, not table membership. An explosives load needs compatibility groups,
    // the §172.504(f) exception interplay, its own §177.848 segregation, and the rule that explosives
    // may never use the DANGEROUS substitution. None of that is implemented, so emitting a bare
    // EXPLOSIVES 1.4 diamond would UNDERSTATE the load — the exact D2 failure the Table 1 gate exists
    // to prevent, arriving through a different door. Recognise and block instead.
    //
    // The alternative — editing the dataset to call these Table 1 — was rejected outright: the dataset
    // states the regulation, and the parser asserts its own table signatures precisely so nobody can
    // quietly move a row to make the code's life easier.
    if (isExplosivesDivision(key)) {
      explosivesHits.push({ hmtRef: line.hmtRef, classOrDivision: spec.classOrDivision });
      trace.push({ ruleId: "explosives_recognized", fired: true, inputs: { hmtRef: line.hmtRef, class: entry.hazardClass }, citations: [{ cfr: "49 CFR 172.504" }], note: "Explosives division — placard logic deferred (D4-revised)" });
      continue;
    }
    const placard = toPlacardName(spec.placardName);
    if (placard == null) {
      // e.g. 6.2 → "NONE": a recognized material that takes no placard
      trace.push({ ruleId: "class_to_placard", fired: true, inputs: { hmtRef: line.hmtRef, placardName: spec.placardName }, citations: [{ cfr: `49 CFR ${spec.designRef ?? "172.504"}` }], note: "no placard for this class" });
      continue;
    }

    // ── H-LQ (0.10.0): the Limited Quantity gate, per line ──────────────────────────────────────
    let lqAccepted = false;
    if (line.isLimitedQuantity) {
      const lq = verifyLqClaim(line, entry, key, load.vehicle.kind === "cargo_tank");
      if (lq.accepted) {
        lqAccepted = true;
        findings.push({
          ruleId: "lq_excepted_from_placarding",
          tier: "info",
          message:
            `${entry.psnPrinted} is declared a Limited Quantity and the HMT authorizes exceptions for it (§173.${pgRowForRef(entry, line.hmtRef)?.exceptionsRef}) — ` +
            "identified per §172.203(b)/§172.315, the placarding subpart does not apply to this line (§172.500(b)(2)). " +
            "The declaration (including inner-receptacle limits) is the offeror's; the LQ surface mark must be displayed.",
          citations: [{ cfr: "49 CFR 172.500(b)(2)" }, { cfr: "49 CFR 172.315(a)" }],
          evidence: { hmtRef: line.hmtRef, exceptionsRef: pgRowForRef(entry, line.hmtRef)?.exceptionsRef ?? null },
        });
        if (!placards.marks.some((m) => m.mark === "LIMITED_QUANTITY")) {
          placards.marks.push({
            mark: "LIMITED_QUANTITY",
            positions: "one side or end of each package (square-on-point, ≥100 mm; 50 mm reduced size allowed)",
            because: [{ cfr: "49 CFR 172.315(a)" }],
          });
        }
        trace.push({ ruleId: "lq_gate", fired: true, inputs: { hmtRef: line.hmtRef, accepted: true }, citations: [{ cfr: "49 CFR 172.500(b)(2)" }] });
      } else {
        findings.push({
          ruleId: "lq_claim_refused",
          tier: "conditional",
          message:
            `The Limited Quantity claim on ${entry.psnPrinted} is REFUSED: ${lq.reason}. ` +
            "The line is evaluated fully regulated (placards asserted, aggregate counted) — route to a hazmat-trained reviewer.",
          citations: [{ cfr: lq.cfr }, { cfr: "49 CFR 172.500(b)(2)" }],
          evidence: { hmtRef: line.hmtRef, reason: lq.reason },
        });
        trace.push({ ruleId: "lq_gate", fired: true, inputs: { hmtRef: line.hmtRef, accepted: false }, citations: [{ cfr: lq.cfr }], note: lq.reason });
      }
    }

    resolved.push({ line, entry, spec, placard, lqAccepted });
    trace.push({ ruleId: "class_to_placard", fired: true, inputs: { hmtRef: line.hmtRef, class: entry.hazardClass, placard, table: spec.table, lqAccepted }, citations: [{ cfr: `49 CFR ${spec.designRef ?? "172.504"}` }] });
  }

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
    return { placards, findings, trace }; // recognized, none placardable → no placards, nothing withheld
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

  // ── 3b) §172.505 subsidiary placards ──────────────────────────────────────────────────────────
  // A Table 2 material can carry an inhalation or dangerous-when-wet subsidiary hazard, and then it
  // needs that placard IN ADDITION to its own. D4 kept these live precisely because dropping them
  // "would be a silent hole"; they were nevertheless never implemented.
  const add505 = (placard: PlacardName, cfr: string, rs: Resolved[]): void => {
    if (placards.required.some((p) => p.placard === placard)) return;
    placards.required.push({ placard, positions: "each_side_and_each_end", because: [{ cfr }] });
    trace.push({
      ruleId: "subsidiary_placard_172_505",
      fired: true,
      inputs: { placard, lines: rs.map((r) => r.line.hmtRef) },
      citations: [{ cfr }],
    });
  };
  const pihLines = table2.filter((r) => subsidiary505(r.entry).pih);
  const dwwLines = table2.filter((r) => subsidiary505(r.entry).dww);
  if (pihLines.length > 0) add505("POISON_INHALATION_HAZARD", "49 CFR 172.505(a)", pihLines);
  if (dwwLines.length > 0) add505("DANGEROUS_WHEN_WET", "49 CFR 172.505(b)", dwwLines);

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

  // 6) §172.302(c)/172.331 ID-number display for bulk (R3: exact bulk trigger pending the SME footnote)
  const bulkLines = resolved.filter((r) => r.line.packagingKind === "bulk" || isTank);
  const seenId = new Set<string>();
  for (const r of bulkLines) {
    const idNumber = `${r.entry.idPrefix}${r.entry.idNumber}`;
    if (seenId.has(idNumber)) continue;
    seenId.add(idNumber);
    placards.idDisplays.push({
      idNumber,
      format: "orange_panel",
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
  if (nonBulk.length > 0 && nbIds.size === 1 && notClass1or7 && (!nbWeightKnown || nbAggregateLb >= NONBULK_ID_THRESHOLD_LB)) {
    const idNumber = [...nbIds][0] as string;
    if (!seenId.has(idNumber)) {
      seenId.add(idNumber);
      placards.idDisplays.push({
        idNumber,
        format: "orange_panel",
        positions: "each_side_and_each_end",
        because: [{ cfr: "49 CFR 172.301(a)(3)" }],
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
        `Confirm the loading-facility and no-other-material conditions.`,
      citations: [{ cfr: "49 CFR 172.301(a)(3)" }],
      evidence: { aggregateLb: nbWeightKnown ? nbAggregateLb : null, packageCount: nbPackages, idNumber },
    });
    trace.push({
      ruleId: "nonbulk_id_display_172_301",
      fired: true,
      inputs: { aggregateLb: nbWeightKnown ? nbAggregateLb : null, singleMaterial: idNumber },
      citations: [{ cfr: "49 CFR 172.301(a)(3)" }],
      note: "R1 resolved: the 8,820 lb figure is the 4,000 kg non-bulk single-material trigger (PHMSA Chart 15).",
    });
  }

  // 7) ERG guides + HOT mark
  for (const r of resolved) {
    const guide = ds.erg.find((e) => e.idNumber === r.entry.idNumber);
    if (guide && !placards.ergGuides.some((g) => g.idNumber === guide.idNumber)) {
      placards.ergGuides.push({ idNumber: guide.idNumber, guide: guide.guideNumber });
    }
  }
  if (resolved.some((r) => r.entry.idNumber === "3257" || /elevated temperature/i.test(r.entry.psnPrinted))) {
    placards.marks.push({ mark: "HOT", positions: "two_sides_or_each_side_and_each_end", because: [{ cfr: "49 CFR 172.325" }] });
  }

  // 8) provisional dataset → the app must not CLEAR (H1.6/D2); the calculation still stands
  if (ds.provisional) {
    findings.push({
      ruleId: "dataset_provisional",
      tier: "conditional",
      message: "The regulatory dataset is provisional (not yet second-source-verified). Placards are computed for reference but the load may not be auto-cleared.",
      citations: [{ cfr: "internal: provisional dataset (plan H1.6/D2)" }],
      evidence: { version: ds.version },
    });
  }

  return { placards, findings, trace };
}
