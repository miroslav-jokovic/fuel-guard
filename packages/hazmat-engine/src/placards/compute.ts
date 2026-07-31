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

import type { Finding, LoadInput, PlacardName, PlacardOutput, TraceNode } from "../types.js";
import { emptyPlacards } from "../types.js";

// ── minimal consumer view of the dataset (engine may not import @hazmat/data) ────────────────────
interface DsPgRow { pg: "I" | "II" | "III" | null; labelCodes?: string[]; specialProvisions?: string[] }
interface DsEntry {
  entryId: string;
  psnPrinted: string;
  psnAlternates?: string[];
  hazardClass: string | null;
  subsidiaryClasses?: string[];
  idPrefix: "UN" | "NA";
  idNumber: string;
  pgRows: DsPgRow[];
}
interface DsPlacard { classOrDivision: string; table: 1 | 2; placardName: string; designRef: string | null; wordingOptions?: string[] }
interface DsErg { idNumber: string; guideNumber: string }
interface DsView { version: string; provisional: boolean; entries: DsEntry[]; placards: DsPlacard[]; erg: DsErg[] }

function readDataset(load: LoadInput): DsView {
  const d = load.dataset as unknown as Partial<DsView>;
  return {
    version: d.version ?? "unknown",
    provisional: d.provisional === true,
    entries: Array.isArray(d.entries) ? d.entries : [],
    placards: Array.isArray(d.placards) ? d.placards : [],
    erg: Array.isArray(d.erg) ? d.erg : [],
  };
}

const PLACARD_NAMES = new Set<PlacardName>([
  "FLAMMABLE", "GASOLINE", "COMBUSTIBLE", "FUEL_OIL", "FLAMMABLE_GAS", "NON_FLAMMABLE_GAS",
  "OXYGEN", "POISON_GAS", "FLAMMABLE_SOLID", "SPONTANEOUSLY_COMBUSTIBLE", "DANGEROUS_WHEN_WET",
  "OXIDIZER", "ORGANIC_PEROXIDE", "POISON", "POISON_INHALATION_HAZARD", "CORROSIVE",
  "RADIOACTIVE", "CLASS_9", "DANGEROUS",
  "EXPLOSIVES_1_1", "EXPLOSIVES_1_2", "EXPLOSIVES_1_3", "EXPLOSIVES_1_4", "EXPLOSIVES_1_5", "EXPLOSIVES_1_6",
]);

function toPlacardName(printed: string): PlacardName | null {
  const key = printed.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return PLACARD_NAMES.has(key as PlacardName) ? (key as PlacardName) : null;
}

/** Leading class/division token, e.g. "5.2 (Organic…)" → "5.2"; "Combustible liquid" → "combustible liquid". */
function baseClass(s: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(s);
  return m ? (m[1] as string) : s.trim().toLowerCase();
}

/** The class a line should be PLACARDED as (honors the §173.150(f) combustible-liquid reclassification). */
function effectiveClassKey(entry: DsEntry, reclassedCombustible: boolean): string {
  const hc = entry.hazardClass ?? "";
  if (reclassedCombustible && baseClass(hc) === "3") return "combustible liquid";
  if (/comb/i.test(hc)) return "combustible liquid";
  return baseClass(hc);
}

interface Resolved { line: LoadInput["lines"][number]; entry: DsEntry; spec: DsPlacard; placard: PlacardName }

// ── the ladder ───────────────────────────────────────────────────────────────────────────────────
export interface PlacardComputation {
  placards: PlacardOutput;
  findings: Finding[];
  trace: TraceNode[];
}

function withheld(reason: string, evidence: Record<string, unknown>): Finding {
  return {
    ruleId: "placard_determination_withheld",
    tier: "conditional",
    message: `${reason} — placard determination withheld. Route to a hazmat-trained reviewer.`,
    citations: [{ cfr: "internal: determination withheld (plan D2/D4)" }],
    evidence,
  };
}

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
    if (matches.length !== 1) {
      findings.push(withheld(`Class "${entry.hazardClass}" (key "${key}") maps to ${matches.length} placard rows — outside the fuel scope`, { hmtRef: line.hmtRef, key, matched: matches.length }));
      trace.push({ ruleId: "class_to_placard", fired: false, inputs: { key, matched: matches.length }, citations: [{ cfr: "49 CFR 172.504" }] });
      return { placards, findings, trace };
    }
    const spec = matches[0] as DsPlacard;
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
    const placard = toPlacardName(spec.placardName);
    if (placard == null) {
      // e.g. 6.2 → "NONE": a recognized material that takes no placard
      trace.push({ ruleId: "class_to_placard", fired: true, inputs: { hmtRef: line.hmtRef, placardName: spec.placardName }, citations: [{ cfr: `49 CFR ${spec.designRef ?? "172.504"}` }], note: "no placard for this class" });
      continue;
    }
    resolved.push({ line, entry, spec, placard });
    trace.push({ ruleId: "class_to_placard", fired: true, inputs: { hmtRef: line.hmtRef, class: entry.hazardClass, placard, table: spec.table }, citations: [{ cfr: `49 CFR ${spec.designRef ?? "172.504"}` }] });
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

  if (resolved.length === 0) {
    trace.push({ ruleId: "any_placardable_line", fired: false, inputs: {}, citations: [] });
    return { placards, findings, trace }; // recognized, none placardable → no placards, nothing withheld
  }

  // 2) §172.504(c) weight gate — Table-2 materials need placards only at ≥ 454 kg (1,001 lb) aggregate
  const table2 = resolved.filter((r) => r.spec.table === 2); // Table 1 already gated out above
  const weights = table2.map((r) => r.line.grossWeightLb);
  const weightKnown = weights.every((w) => w != null);
  const aggregateLb = weights.reduce<number>((s, w) => s + (w ?? 0), 0);
  const table2Placards = weightKnown && aggregateLb < 1001 ? false : true; // unknown → conservative
  trace.push({
    ruleId: "weight_threshold_1001lb",
    fired: true,
    inputs: { aggregateLb: weightKnown ? aggregateLb : null, table2Placards },
    citations: [{ cfr: "49 CFR 172.504(c)" }],
    note: weightKnown ? undefined : "aggregate weight unknown → placarding conservatively",
  });
  if (!weightKnown && table2.length > 0) {
    findings.push({
      ruleId: "aggregate_weight_unknown",
      tier: "conditional",
      message: "Aggregate gross weight is unknown, so the 1,001-lb (§172.504(c)) exception cannot be applied — placards are asserted conservatively. Confirm the weight.",
      citations: [{ cfr: "49 CFR 172.504(c)" }],
      evidence: { table2Lines: table2.length },
    });
  }
  if (weightKnown && aggregateLb < 1001) {
    findings.push({
      ruleId: "below_1001lb_no_placard",
      tier: "info",
      message: `Aggregate Table-2 weight is ${aggregateLb} lb (< 1,001 lb), so no placards are required (§172.504(c)).`,
      citations: [{ cfr: "49 CFR 172.504(c)" }],
      evidence: { aggregateLb },
    });
  }

  // 3) which categories actually require a placard, deduped by placard name
  const requiring: Resolved[] = table2Placards ? table2 : [];
  const distinct = new Map<PlacardName, Resolved[]>();
  for (const r of requiring) {
    const arr = distinct.get(r.placard) ?? [];
    arr.push(r);
    distinct.set(r.placard, arr);
  }

  for (const placard of distinct.keys()) {
    placards.required.push({ placard, positions: "each_side_and_each_end", because: [{ cfr: "49 CFR 172.504(a)" }] });
  }

  // 4) §172.504(b) sole-vs-mixed — ≥2 Table-2 categories MAY use one DANGEROUS placard (R2: SME to confirm)
  if (distinct.size >= 2) {
    for (const placard of distinct.keys()) {
      placards.optionalSubstitutions.push({
        instead: placard,
        use: "DANGEROUS",
        because: [{ cfr: "49 CFR 172.504(b)" }],
      });
    }
    trace.push({
      ruleId: "mixed_load_dangerous_option",
      fired: true,
      inputs: { categories: distinct.size },
      citations: [{ cfr: "49 CFR 172.504(b)" }],
      note: "≥2 Table-2 categories: one DANGEROUS placard may replace the specific placards, EXCEPT any category with ≥2,205 lb loaded at one facility still needs its own. R2: confirm the SME's 'worded placard' direction.",
    });
  }

  // 5) §172.542(c)/172.544(c) fuel wording — GASOLINE for gasoline, FUEL OIL for fuel oil (highway tank)
  const isTank = load.vehicle.kind === "cargo_tank";
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
    findings.push({
      ruleId: "nonbulk_single_material_id_display",
      tier: "conditional",
      message:
        `A single-material non-bulk load${nbWeightKnown ? ` of ${nbAggregateLb} lb` : ""} must display its identification number (${idNumber}) ` +
        `when it is ≥ 4,000 kg (8,820 lb), all loaded at one facility, and the vehicle carries no other material (§172.301(a)(3)). ` +
        `Confirm the loading-facility and no-other-material conditions.`,
      citations: [{ cfr: "49 CFR 172.301(a)(3)" }],
      evidence: { aggregateLb: nbWeightKnown ? nbAggregateLb : null, idNumber },
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
