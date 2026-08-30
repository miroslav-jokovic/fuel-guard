import { resolveHmtLine, type DatasetIndex, type ResolveLineResult } from "@hazmat/data";
import type { HazmatLine } from "@hazmat/engine";
import { normalizeUnit, type BolFields, type BolLineFields } from "./bolFields.js";

/**
 * BolFields → engine lines (plan H6 step 5). Deterministic: each extracted line is resolved to a canonical
 * `hmtRef` by `resolveHmtLine` (D1 — the code decides, never the model). Fail-closed: a line that does not
 * resolve, or whose printed unit is unrecognized, produces NO engine line and a named flag, so the load
 * cannot silently clear. `flashPointF`/`ethanolPct` are dataset-overlay inputs (`fuelProducts.json`,
 * pending H1) so they are `null` here — exactly as the manual path leaves them. Every field carries
 * provenance so the review UI can show where each value came from.
 */
export type Provenance = "extracted" | "declared" | "dataset_default";

export interface DeclaredLineRef {
  hmtRef: string;
  reclassedCombustible?: boolean;
  /** H-LQ: the dispatcher's declared LQ election (reconciled against the paper's notation). */
  isLimitedQuantity?: boolean;
  quantityValue?: number | null;
}

export interface MappedLine {
  ok: boolean;
  engineLine?: HazmatLine;
  resolution: ResolveLineResult;
  flags: string[];
  provenance: Record<string, Provenance>;
}

export interface MapBolResult {
  lines: MappedLine[];
  /** True only when every non-dormant line produced a clean engine line with no blocking flag. */
  allResolved: boolean;
  flags: string[];
}

export interface MapBolOptions {
  vehicleKind: "cargo_tank" | "van_or_flatbed";
  /** Dispatcher-declared lines (for the §173.150(f) reclass confirmation — the election is the offeror's). */
  declaredLines?: DeclaredLineRef[];
  /** H-LQ: per-line dual-pass-CONFIRMED "Limited Quantity" notation, aligned to `bol.lines` — computed
   *  by the pipeline from BOTH passes (extract.ts). Absent → false everywhere. A single-pass read is
   *  never enough: setting this wrongly is the one extraction error that could UNDER-placard, so it
   *  takes two independent reads to assert, and the engine still verifies col 8A + the 66-lb cap. */
  lqConfirmed?: boolean[];
}

function derivePackaging(line: BolLineFields, vehicleKind: MapBolOptions["vehicleKind"]): "bulk" | "non_bulk" {
  const txt = (line.packaging ?? "").toLowerCase();
  // H-P1 alignment: totes/IBCs and portable tanks are BULK (§171.8 — a 275/330-gal IBC exceeds 119
  // gal even on a dry van), and hoppers/pneumatics are bulk solids. They were in the non-bulk branch
  // until 2026-08-08 — the same under-classification the manual form's D-H14 rework closed.
  // Plural-tolerant stems: real BOLs print "4 TOTES", "10 DRUMS" — the old singular-only word
  // boundaries silently matched nothing and every phrase fell through to the vehicle default.
  if (/\b(cargo tanks?|tanks?|bulk|totes?|ibcs?|portable tanks?|iso tanks?|hoppers?|pneumatics?)\b/.test(txt)) return "bulk";
  if (/\b(drums?|cases?|cartons?|boxes|box|pails?|jerricans?|cylinders?|bags?|packages?)\b/.test(txt)) return "non_bulk";
  return vehicleKind === "cargo_tank" ? "bulk" : "non_bulk";
}

function mapLine(index: DatasetIndex, line: BolLineFields, opts: MapBolOptions, lqConfirmed: boolean): MappedLine {
  const flags: string[] = [];
  const provenance: Record<string, Provenance> = {};
  const printedCombustible = /combustible/i.test(line.hazardClass ?? "");

  // Resolve. If the paper claims Combustible, resolve WITH the election so the Class-3 entry is found;
  // whether that election actually applies to the engine input is decided separately (below).
  const resolution = resolveHmtLine(index, {
    idText: line.idText,
    psn: line.psn,
    hazardClass: line.hazardClass,
    pg: line.pg,
    reclassedCombustible: printedCombustible,
  });
  if (!resolution.ok) {
    return { ok: false, resolution, flags: [`line_unresolved:${resolution.reason}`], provenance };
  }
  // Resolution findings (pg missing/mismatch, pg-on-no-pg) ride along as review flags.
  for (const f of resolution.findings) flags.push(`resolve:${f}`);
  provenance.hmtRef = "extracted";

  // §173.150(f) election: honor "Combustible liquid" ONLY when a declared line confirms it (the election
  // is the offeror's — D1). Unconfirmed → fail-closed to Class 3 (flammable placard covers combustible).
  let reclassedCombustible = false;
  if (printedCombustible) {
    const confirmed = (opts.declaredLines ?? []).some(
      (d) => d.hmtRef === resolution.hmtRef && d.reclassedCombustible === true,
    );
    if (confirmed) {
      reclassedCombustible = true;
      provenance.reclassedCombustible = "declared";
    } else {
      flags.push("reclassification_unconfirmed");
      provenance.reclassedCombustible = "extracted";
    }
  }

  // Quantity: unit must land in the engine's closed set. Value present + unrecognized unit → fail-closed.
  let quantity: HazmatLine["quantity"];
  const unit = normalizeUnit(line.quantity.unit);
  if (line.quantity.value != null) {
    if (unit == null) {
      return { ok: false, resolution, flags: [...flags, "quantity_unit_unrecognized"], provenance };
    }
    quantity = { value: line.quantity.value, unit };
    provenance.quantity = "extracted";
  } else {
    quantity = { value: 0, unit: unit ?? "gal" };
    flags.push("quantity_missing");
    provenance.quantity = "extracted";
  }

  const engineLine: HazmatLine = {
    hmtRef: resolution.hmtRef,
    // §171.8 concentration is never read from the paper: a BOL states the shipping description, not
    // the percent by weight of a marine-pollutant component. Null is the fail-closed answer — the
    // line stays classified as a marine pollutant and the finding asks for the number (0.14.0).
    marinePollutantConcentrationPct: null,
    // Nor the §172.322(d)(1) net quantity per package: a shipping paper states the total, not what
    // each inner packaging holds. Null keeps the mark required, which is the safe direction.
    marinePollutantPerPackage: null,
    reclassedCombustible,
    // H-LQ: true ONLY when BOTH vision passes independently read the §172.203(b)/§172.315 notation
    // (extract.ts computes the confirmation; a one-pass read raises pass_disagreement:lqNotation and
    // maps false — fully regulated, the conservative direction). The engine then verifies the claim
    // against HMT column 8A + the 66-lb cap and refuses fail-closed if anything is off.
    isLimitedQuantity: lqConfirmed,
    quantity,
    grossWeightLb: line.grossWeightLb,
    compartmentIndex: null, // per-compartment declaration deferred (engine does not read it — H5 audit / H2)
    isResidueLine: false,
    flashPointF: null, // fuelProducts.json overlay pending (H1) — same as the manual path
    ethanolPct: null,
    packagingKind: derivePackaging(line, opts.vehicleKind),
    packageCount: line.packageCount,
  };
  provenance.grossWeightLb = "extracted";
  provenance.packagingKind = "extracted";
  provenance.isLimitedQuantity = "extracted";
  provenance.flashPointF = "dataset_default";
  provenance.ethanolPct = "dataset_default";

  // A blocking flag (unconfirmed reclass, missing quantity) means the line is real but needs review.
  const blocked = flags.some((f) => f === "reclassification_unconfirmed" || f === "quantity_missing");
  return { ok: !blocked, engineLine, resolution, flags, provenance };
}

export function mapBolLines(index: DatasetIndex, bol: BolFields, opts: MapBolOptions): MapBolResult {
  const lines = bol.lines.map((l, i) => mapLine(index, l, opts, opts.lqConfirmed?.[i] ?? false));
  const flags = [...new Set(lines.flatMap((l) => l.flags))];
  const allResolved = lines.every((l) => l.ok);
  return { lines, allResolved, flags };
}
