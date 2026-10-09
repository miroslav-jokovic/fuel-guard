/**
 * Shared fixtures for the printed-paper audit's tests. The HMT rows are copied from dataset 2026.08.0
 * (id, PSN, class, PG, column 8A as that dataset carries them); the Appendix A and B rows likewise, so a
 * test reads like a real paper rather than an invented one.
 */
import { auditPrintedPaper } from "./auditPrintedPaper.js";
import type {
  PaperFieldStates,
  PaperResolution,
  PaperRuleId,
  PaperRuleResult,
  PrintedPaper,
  PrintedPaperLine,
  ResolvedPaper,
  ResolvedPaperLine,
} from "./paperTypes.js";

export const DS = {
  version: "paper-test",
  provisional: false,
  entries: [
    { entryId: "UN1203-gasoline", symbols: [], psnPrinted: "Gasoline", psnAlternates: [], hazardClass: "3", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1203", pgRows: [{ pg: "II", exceptionsRef: "150" }] },
    { entryId: "UN1075-petroleum-gases-liquefied", symbols: [], psnPrinted: "Petroleum gases, liquefied", psnAlternates: ["Liquefied petroleum gas"], hazardClass: "2.1", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1075", pgRows: [{ pg: null, exceptionsRef: "306" }] },
    { entryId: "UN1993-flammable-liquids-n-o-s", symbols: ["G"], psnPrinted: "Flammable liquids, n.o.s.", psnAlternates: [], hazardClass: "3", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1993", pgRows: [{ pg: "I", exceptionsRef: "150" }, { pg: "II", exceptionsRef: "150" }, { pg: "III", exceptionsRef: "150" }] },
    { entryId: "UN1114-benzene", symbols: [], psnPrinted: "Benzene", psnAlternates: [], hazardClass: "3", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1114", pgRows: [{ pg: "II", exceptionsRef: "150" }] },
    { entryId: "UN1541-acetone-cyanohydrin-stabilized", symbols: [], psnPrinted: "Acetone cyanohydrin, stabilized", psnAlternates: [], hazardClass: "6.1", subsidiaryClasses: [], idPrefix: "UN", idNumber: "1541", pgRows: [{ pg: "I", exceptionsRef: null }] },
    { entryId: "UN3082-environmentally-hazardous-substance-liquid-n-o-s", symbols: ["G"], psnPrinted: "Environmentally hazardous substance, liquid, n.o.s.", psnAlternates: [], hazardClass: "9", subsidiaryClasses: [], idPrefix: "UN", idNumber: "3082", pgRows: [{ pg: "III", exceptionsRef: "155" }] },
    { entryId: "UN3171-battery-powered-vehicle", symbols: [], psnPrinted: "Battery-powered vehicle", psnAlternates: ["Battery-powered equipment"], hazardClass: "9", subsidiaryClasses: [], idPrefix: "UN", idNumber: "3171", pgRows: [{ pg: null, exceptionsRef: "220" }] },
    { entryId: "UN3497-krill-meal", symbols: [], psnPrinted: "Krill meal", psnAlternates: [], hazardClass: "4.2", subsidiaryClasses: [], idPrefix: "UN", idNumber: "3497", pgRows: [{ pg: "II", exceptionsRef: null }, { pg: "III", exceptionsRef: null }] },
    { entryId: "NA3082-hazardous-waste-liquid-n-o-s", symbols: ["G"], psnPrinted: "Hazardous waste, liquid, n.o.s.", psnAlternates: [], hazardClass: "9", subsidiaryClasses: [], idPrefix: "NA", idNumber: "3082", pgRows: [{ pg: "III", exceptionsRef: "155" }] },
    { entryId: "UN2734-amine-liquid-corrosive-flammable-n-o-s", symbols: ["G"], psnPrinted: "Amine, liquid, corrosive, flammable, n.o.s.", psnAlternates: ["Polyamines, liquid, corrosive, flammable, n.o.s."], hazardClass: "8", subsidiaryClasses: [], idPrefix: "UN", idNumber: "2734", pgRows: [{ pg: "I", exceptionsRef: null }, { pg: "II", exceptionsRef: "154" }] },
    { entryId: "NA1993-diesel-fuel", symbols: ["D"], psnPrinted: "Diesel fuel", psnAlternates: [], hazardClass: "3", subsidiaryClasses: [], idPrefix: "NA", idNumber: "1993", pgRows: [{ pg: "III", exceptionsRef: "150" }] },
    { entryId: "UN2794-batteries-wet-filled-with-acid", symbols: [], psnPrinted: "Batteries, wet, filled with acid", psnAlternates: [], hazardClass: "8", subsidiaryClasses: [], idPrefix: "UN", idNumber: "2794", pgRows: [{ pg: null, exceptionsRef: "159" }] },
  ],
  hazSubstances: [
    { name: "Benzene", nameNormalized: "benzene", rqPounds: 10, rqKg: 4.54 },
    { name: "Toluene", nameNormalized: "toluene", rqPounds: 1000, rqKg: 454 },
  ],
  marinePollutants: [{ name: "Acetone cyanohydrin, stabilized", nameNormalized: "acetone cyanohydrin, stabilized", severe: false }],
};

/** The same rows as a dataset cut before column 8A existed (2026.07.1 carries no `exceptionsRef`). */
export const DS_PRE_8A = {
  ...DS,
  version: "paper-test-pre-8a",
  entries: DS.entries.map((e) => ({ ...e, pgRows: e.pgRows.map(({ pg }) => ({ pg })) })),
};

export const pline = (over: Partial<PrintedPaperLine> = {}): PrintedPaperLine => ({
  idText: "UN1203",
  psn: "Gasoline",
  hazardClass: "3",
  pg: "II",
  technicalName: null,
  quantity: { value: 8000, unit: "gal" },
  packageCount: 1,
  packaging: "1 cargo tank",
  hmColumnMark: null,
  marks: [],
  ...over,
});

export const ok = (entryId: string, pg: "I" | "II" | "III" | null, over: Partial<Extract<PaperResolution, { ok: true }>> = {}): PaperResolution => ({
  ok: true,
  entryId,
  pg,
  matchedName: DS.entries.find((e) => e.entryId === entryId)?.psnPrinted ?? "",
  findings: [],
  ...over,
});

export const failed = (reason: string, candidates?: Array<{ entryId: string; psn: string }>): PaperResolution => ({
  ok: false,
  reason,
  ...(candidates ? { candidates } : {}),
});

export const rline = (resolution: PaperResolution | null, over: Partial<ResolvedPaperLine> = {}): ResolvedPaperLine => ({
  resolution,
  quantityUnit: "gal",
  packagingKind: "bulk",
  claimedLimitedQuantity: null,
  ...over,
});

export const GASOLINE = (): [PrintedPaperLine, ResolvedPaperLine] => [pline(), rline(ok("UN1203-gasoline", "II"))];

export interface Case {
  lines: Array<[PrintedPaperLine, ResolvedPaperLine]>;
  paper?: Partial<PrintedPaper["hazmat"]> & {
    pageOf?: PrintedPaper["identity"]["pageOf"];
    printedPageNumbers?: PrintedPaper["identity"]["printedPageNumbers"];
  };
  resolved?: Partial<Omit<ResolvedPaper, "lines">>;
  fieldStates?: PaperFieldStates;
}

export function run(c: Case): readonly PaperRuleResult[] {
  const printed: PrintedPaper = {
    identity: {
      pageOf: c.paper?.pageOf ?? null,
      ...(c.paper && "printedPageNumbers" in c.paper ? { printedPageNumbers: c.paper.printedPageNumbers } : {}),
    },
    hazmat: {
      lines: c.lines.map(([p]) => p),
      emergencyPhone: c.paper && "emergencyPhone" in c.paper ? (c.paper.emergencyPhone ?? null) : "800-555-0142",
      shipperCertification: c.paper && "shipperCertification" in c.paper ? (c.paper.shipperCertification ?? null) : true,
    },
  };
  const resolved: ResolvedPaper = { dataset: DS, ...c.resolved, lines: c.lines.map(([, r]) => r) };
  return auditPrintedPaper(printed, resolved, c.fieldStates).results;
}

/** The one result for `ruleId` on line `lineIndex` (null = document level). Throws if absent or doubled. */
export function result(c: Case, ruleId: PaperRuleId, lineIndex: number | null = 0): PaperRuleResult {
  const hits = run(c).filter((r) => r.ruleId === ruleId && r.lineIndex === lineIndex);
  if (hits.length !== 1) throw new Error(`expected one ${ruleId} result on line ${lineIndex}, got ${hits.length}`);
  return hits[0]!;
}
