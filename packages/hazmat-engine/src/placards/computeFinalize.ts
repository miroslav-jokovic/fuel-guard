import type { Finding, PlacardName, TraceNode } from "../types.js";
import { subsidiary505 } from "./classify.js";
import type { PlacardComputation, Resolved } from "./computeSupport.js";

type Placards = PlacardComputation["placards"];

type ErgGuide = { idNumber: string; guideNumber: string };

export function addSubsidiaryPlacards(
  placards: Placards,
  trace: TraceNode[],
  table2: Resolved[],
): Set<PlacardName> {
  // ── 3b) §172.505 subsidiary placards ──────────────────────────────────────────────────────────
  // A Table 2 material can carry an inhalation or dangerous-when-wet subsidiary hazard, and then it
  // needs that placard IN ADDITION to its own. D4 kept these live precisely because dropping them
  // "would be a silent hole"; they were nevertheless never implemented.
  // §172.334 also bars an identification number on a placard displayed for a SUBSIDIARY hazard. That
  // is a fact about WHY the placard is up, not about its design, so it can only be recorded here.
  const subsidiaryPlacards = new Set<PlacardName>();
  const add505 = (placard: PlacardName, cfr: string, rs: Resolved[]): void => {
    subsidiaryPlacards.add(placard);
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
  return subsidiaryPlacards;
}

export function finalizePlacards({
  placards,
  findings,
  resolved,
  erg,
  provisional,
  datasetVersion,
}: {
  placards: Placards;
  findings: Finding[];
  resolved: Resolved[];
  erg: ErgGuide[];
  provisional: boolean;
  datasetVersion: string;
}): void {
  // 7) ERG guides + HOT mark
  for (const r of resolved) {
    const guide = erg.find((e) => e.idNumber === r.entry.idNumber);
    if (guide && !placards.ergGuides.some((g) => g.idNumber === guide.idNumber)) {
      placards.ergGuides.push({ idNumber: guide.idNumber, guide: guide.guideNumber });
    }
  }
  if (resolved.some((r) => r.entry.idNumber === "3257" || /elevated temperature/i.test(r.entry.psnPrinted))) {
    placards.marks.push({ mark: "HOT", positions: "two_sides_or_each_side_and_each_end", because: [{ cfr: "49 CFR 172.325" }] });
  }

  // 8) provisional dataset → the app must not CLEAR (H1.6/D2); the calculation still stands
  if (provisional) {
    findings.push({
      ruleId: "dataset_provisional",
      tier: "conditional",
      message: "The regulatory dataset is provisional (not yet second-source-verified). Placards are computed for reference but the load may not be auto-cleared.",
      citations: [{ cfr: "internal: provisional dataset (plan H1.6/D2)" }],
      evidence: { version: datasetVersion },
    });
  }
}
