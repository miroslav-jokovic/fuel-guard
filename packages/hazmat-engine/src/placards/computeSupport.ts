import type {
  Citation,
  Finding,
  IdDisplayFormat,
  LoadInput,
  PlacardName,
  PlacardOutput,
  TraceNode,
} from "../types.js";
import {
  LQ_ENCODED_CLASS_KEYS,
  LQ_PACKAGE_GROSS_CAP_LB,
  pgRowForRef,
  type DsEntry,
  type DsPlacard,
} from "./classify.js";

export interface Resolved {
  line: LoadInput["lines"][number];
  entry: DsEntry;
  spec: DsPlacard;
  placard: PlacardName;
  /** H-LQ (0.10.0): the offeror's LQ claim was VERIFIED and accepted. */
  lqAccepted: boolean;
}

export interface PlacardComputation {
  placards: PlacardOutput;
  findings: Finding[];
  trace: TraceNode[];
}

/**
 * H-LQ (0.10.0) — verify one line's Limited Quantity claim, fail-closed. A claim is ACCEPTED only
 * when every checkable fact supports it; anything else refuses and leaves the line fully regulated.
 */
export function verifyLqClaim(
  line: LoadInput["lines"][number],
  entry: DsEntry,
  classKey: string,
  isTank: boolean,
): { accepted: true } | { accepted: false; reason: string; cfr: string } {
  if (isTank || line.packagingKind === "bulk") {
    return {
      accepted: false,
      reason: "a Limited Quantity is by definition non-bulk packaging — this line is bulk",
      cfr: "49 CFR 171.8",
    };
  }
  if (!LQ_ENCODED_CLASS_KEYS.has(classKey)) {
    return {
      accepted: false,
      reason: `LQ semantics for class "${classKey}" are not encoded (gases use §173.306's own structure; Classes 1/7 and Divisions 6.1/6.2 sit outside the §172.315 mark scheme)`,
      cfr: "49 CFR 172.315(a)",
    };
  }
  const row = pgRowForRef(entry, line.hmtRef);
  if (!row || !("exceptionsRef" in row)) {
    return {
      accepted: false,
      reason: "the loaded dataset predates HMT column 8A (exceptions) — use dataset 2026.08.0 or later to evaluate LQ claims",
      cfr: "49 CFR 172.101 col. 8A",
    };
  }
  if (row.exceptionsRef == null) {
    return {
      accepted: false,
      reason: `the §172.101 table lists NO exceptions section for ${entry.psnPrinted} (column 8A is "None") — a Limited Quantity is not authorized`,
      cfr: "49 CFR 172.101 col. 8A",
    };
  }
  if (line.grossWeightLb != null && line.packageCount != null && line.packageCount > 0) {
    const perPackage = line.grossWeightLb / line.packageCount;
    if (perPackage > LQ_PACKAGE_GROSS_CAP_LB) {
      return {
        accepted: false,
        reason: `per-package gross weight ${Math.round(perPackage)} lb exceeds the 30 kg (66 lb) LQ package cap (§173.150(b)/§173.155(b) family)`,
        cfr: "49 CFR 173.150(b)",
      };
    }
  }
  return { accepted: true };
}

// ── identification-number DISPLAY formats (§172.332 / §172.334 / §172.336) ─────────────────────
//
// An identification number is ONE requirement with several lawful presentations. The engine used to
// assert `format: "orange_panel"` and stop, which reads as "the orange panel is the answer" — so a
// 44,307 lb van of UN1789 came back as a worded CORROSIVE diamond PLUS a separate orange panel, when
// the display that actually rolls down the road is a single CORROSIVE diamond with 1789 across its
// center. §172.301(a)(3) says the marking is made "as specified in §172.332 or §172.336", and those
// sections authorize all three.

/** §172.334(a): placard designs that may NEVER carry an identification number. */
export const ID_NUMBER_PROHIBITED_PLACARDS: ReadonlySet<PlacardName> = new Set<PlacardName>([
  "RADIOACTIVE",
  "DANGEROUS",
  "EXPLOSIVES_1_1",
  "EXPLOSIVES_1_2",
  "EXPLOSIVES_1_3",
  "EXPLOSIVES_1_4",
  "EXPLOSIVES_1_5",
  "EXPLOSIVES_1_6",
]);

export interface IdDisplayPlan {
  format: IdDisplayFormat;
  alternateFormats: Array<{ format: IdDisplayFormat; because: Citation[]; note?: string }>;
  onPlacards: PlacardName[];
}

/**
 * Every lawful way to display `idNumber` on this vehicle, recommended first.
 *
 * `carriers` are the placards REQUIRED for the load that the number may legally ride on: the caller
 * removes anything §172.505 put up for a subsidiary hazard (that bar is a property of WHY the placard
 * is displayed, not of its design, so only the caller knows it), and this function removes the
 * designs §172.334 bars outright. If nothing survives, the number needs its own panel and
 * `onPlacards` comes back empty — never a silent omission.
 */
export function planIdDisplay(carriers: readonly PlacardName[]): IdDisplayPlan {
  const onPlacards = carriers.filter((p) => !ID_NUMBER_PROHIBITED_PLACARDS.has(p));
  const orangePanel = {
    format: "orange_panel" as const,
    because: [{ cfr: "49 CFR 172.332(b)" }],
    note: "160 × 400 mm orange panel with a 15 mm black border; 100 mm black numerals.",
  };
  const whiteSquare = {
    format: "white_square_on_point" as const,
    because: [{ cfr: "49 CFR 172.336(b)" }],
    note: "A plain white square-on-point the size of a placard. It is expressly NOT a placard — it does not satisfy any placarding requirement on its own.",
  };
  if (onPlacards.length === 0) {
    return { format: "orange_panel", alternateFormats: [orangePanel, whiteSquare], onPlacards: [] };
  }
  const onPlacard = {
    format: "on_placard" as const,
    because: [{ cfr: "49 CFR 172.332(c)" }],
    note: "Across the center area of the placard: 88 mm black Alpine/Alternate Gothic No. 3 numerals on a 100 × 215 mm white background whose top sits ~40 mm above the placard centerline. No UN/NA prefix on the placard itself.",
  };
  return { format: "on_placard", alternateFormats: [onPlacard, orangePanel, whiteSquare], onPlacards };
}

export function withheld(reason: string, evidence: Record<string, unknown>): Finding {
  return {
    ruleId: "placard_determination_withheld",
    tier: "conditional",
    message: `${reason} — placard determination withheld. Route to a hazmat-trained reviewer.`,
    citations: [{ cfr: "internal: determination withheld (plan D2/D4)" }],
    evidence,
  };
}
