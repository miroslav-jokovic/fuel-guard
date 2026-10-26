import { describe, expect, it } from "vitest";
import {
  auditPrintedPaper,
  classifyMarinePollutantEntry,
  matchAppendixNames,
  type PaperRuleId,
  type PaperRuleResult,
  type PrintedPaperLine,
  type ResolvedPaper,
  type ResolvedPaperLine,
} from "@hazmat/engine";
import {
  buildDatasetIndex,
  LATEST_DATASET_VERSION,
  listDatasetVersions,
  loadDataset,
  resolveHmtLine,
  type Dataset,
  type HmtEntry,
  type PackingGroup,
} from "@hazmat/data";

/**
 * RC5 (READER-CORRECTNESS-PLAN §5): the paper audit's rules over a golden paper for every row of the table.
 *
 * Every HMT row is printed the way a correct shipping paper prints it — prefixed id, the row's own name, its class
 * with subsidiaries, its packing group, in §172.202(b)'s order; on a G entry two technical names in parentheses;
 * "RQ" where the package holds the reportable quantity; "MARINE POLLUTANT" on a bulk package of an Appendix B
 * material; the quantity with its unit, the count and type of packages — once in two drums and once in a cargo
 * tank, and run through the real table matching (`resolveHmtLine`) and `auditPrintedPaper`. Then one defect at a
 * time. What must hold, on every row:
 *   - the golden paper passes every rule — a correct paper is never called wrong, and never waits on a person —
 *     but for the answers pinned in EXPECTED_WAITS, each with the regulation's reason;
 *   - each single defect fails the rule that owns it, with its reason, and no other rule fails: a rule that needs
 *     the row may wait when the defect is in what picks the row, but none may say "wrong" for a fault not its own;
 *   - no defect ever passes the rule that owns it (P1), unless the regulation itself excepts that material, which
 *     the defect names (§172.604(d)'s list for the emergency number). Where only facts off the paper decide an
 *     exception (a G name that already names its chemical group, §172.203(k)(2)(iii); a solution whose
 *     concentration is not printed, §171.8), the rule waits — never passes.
 *
 * It runs on the dataset production reads under and on the newest cut. The first carries neither column 8A nor the
 * chemical-group flag, so the Limited Quantity and technical-name defects wait there (`requirement_not_in_dataset`);
 * the newest carries both and is judged in full. A new cut is in the census the day it lands.
 */

const NEWEST = listDatasetVersions()
  .filter((v) => /^\d{4}\.\d{2}\.\d+$/.test(v))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1)!;
const VERSIONS = [...new Set([LATEST_DATASET_VERSION, NEWEST])];

/** Two technical names no appendix lists, so the technical name never makes a golden line RQ or marine pollutant. */
const TECH = "ALPHA RESIN, BETA RESIN";
const ROMAN: PackingGroup[] = ["I", "II", "III"];

/**
 * The golden answers that are not a pass, and why each is right. UN0190's division is assigned with its approval
 * (§173.56) and the table gives none, so a printed division cannot be checked against the table.
 */
const EXPECTED_WAITS: Record<string, string> = {
  "UN0190-samples-explosive paper_class_pg_match": "class_not_in_table",
};

interface Row {
  e: HmtEntry;
  pg: PackingGroup | null;
  rqListed: "neat" | "mixture" | null;
  mp: boolean;
  lq: "authorised" | "not_authorised" | "not_in_dataset";
  /** Rows the paper cannot tell from this one (same id, name, class, subsidiaries and PG), this one included. */
  twins: { entryId: string; exceptionsRef: string | null | undefined }[];
}
/** The parts of a printed description; `lot` is a commercial word some shippers print inside it. */
interface Parts { rq: boolean; id: string; psn: string; tech: string | null; cls: string; pg: PackingGroup | null; mp: boolean }
type Piece = "rq" | "id" | "psn" | "lot" | "cls" | "pg" | "mp";
const ORDER: Piece[] = ["rq", "id", "psn", "cls", "pg", "mp"];
interface Paper {
  parts: Parts;
  line: PrintedPaperLine;
  resolved: Omit<ResolvedPaperLine, "resolution">;
  paper: Partial<Omit<ResolvedPaper, "lines" | "dataset">>;
  printed: { emergencyPhone: string | null; shipperCertification: boolean | null; marker: string };
}

const classText = (e: HmtEntry) => (e.subsidiaryClasses.length ? `${e.hazardClass} (${e.subsidiaryClasses.join(", ")})` : e.hazardClass);
const names = (e: HmtEntry) => [e.psnPrinted, ...e.psnAlternates];

/** The description as a shipper prints it: §172.202(b)'s order, "RQ" before it and "MARINE POLLUTANT" after. */
function printDescription(p: Parts, order: Piece[] = ORDER): string {
  const piece: Record<Piece, string | null> = {
    rq: p.rq ? "RQ" : null, id: p.id || null, psn: `${p.psn}${p.tech ? ` (${p.tech})` : ""}`, lot: "LOT 4471Q",
    cls: p.cls || null, pg: p.pg ? `PG ${p.pg}` : null, mp: p.mp ? "MARINE POLLUTANT" : null,
  };
  return order.map((k) => piece[k]).filter(Boolean).join(", ");
}

function census(ds: Dataset) {
  const index = buildDatasetIndex(ds);
  const rows: Row[] = ds.entries.flatMap((e) => {
    const { neat, mixture } = matchAppendixNames(names(e), ds.hazSubstances);
    const rqListed = neat.some((s) => s.rqPounds != null) ? "neat" : mixture.some((s) => s.rqPounds != null) ? "mixture" : null;
    const mp = classifyMarinePollutantEntry(e, ds.marinePollutants).listed;
    const twins = (pg: PackingGroup | null) => ds.entries
      .filter((x) => x.idPrefix === e.idPrefix && x.idNumber === e.idNumber && x.hazardClass === e.hazardClass &&
        x.psnPrinted.toLowerCase() === e.psnPrinted.toLowerCase() && x.subsidiaryClasses.join() === e.subsidiaryClasses.join())
      .flatMap((x) => x.pgRows.filter((r) => r.pg === pg).map((r) => ({ entryId: x.entryId, exceptionsRef: r.exceptionsRef })));
    return e.pgRows.map((r): Row => ({
      e, pg: r.pg, rqListed, mp, twins: twins(r.pg),
      lq: !("exceptionsRef" in r) ? "not_in_dataset" : r.exceptionsRef != null ? "authorised" : "not_authorised",
    }));
  });
  /** Every PG any row of this id carries — a "wrong" PG is one none of them has, never a sibling row's. */
  const pgsOfId = (e: HmtEntry) => ds.entries.filter((x) => x.idPrefix === e.idPrefix && x.idNumber === e.idNumber).flatMap((x) => x.pgRows.map((r) => r.pg));

  /** A correct paper for this row: two drums of 5 lb, or one cargo tank of 40,000 lb (over every RQ in Appendix A). */
  function golden(row: Row, bulk: boolean): Paper {
    const { e, pg } = row;
    const g = e.symbols.includes("G");
    const lbPer = bulk ? 40_000 : 5;
    const count = bulk ? 1 : 2;
    const { neat, mixture } = matchAppendixNames(names(e), ds.hazSubstances);
    const rq = [...neat, ...mixture].some((s) => s.rqPounds != null && lbPer >= s.rqPounds);
    // "Samples, explosive" carries no class in the table — §173.56 assigns it with the approval — and the paper prints it.
    const parts: Parts = { rq, id: `${e.idPrefix}${e.idNumber}`, psn: e.psnPrinted, tech: g ? TECH : null, cls: classText(e) ?? "1.1", pg, mp: row.mp && bulk };
    return {
      parts,
      line: {
        idText: parts.id, psn: parts.psn, hazardClass: parts.cls, pg, technicalName: parts.tech,
        quantity: { value: lbPer * count, unit: "lb" }, packageCount: count, packaging: bulk ? "1 cargo tank" : `${count} drums`,
        grossWeightLb: lbPer * count + (bulk ? 0 : 20), hmColumnMark: rq ? "RQ" : "X",
        marks: [...(rq ? ["RQ"] : []), ...(parts.mp ? ["MARINE POLLUTANT"] : [])], descriptionText: printDescription(parts),
      },
      resolved: { quantityUnit: "lb", packagingKind: bulk ? "bulk" : "non_bulk", claimedLimitedQuantity: null, hazardousComponents: g ? 2 : null, subjectToPart130: false },
      paper: { mixedPaper: false, vesselLeg: false, imageCount: 1, pagesPresent: [1], certificationExempt: false },
      printed: { emergencyPhone: "800-424-9300", shipperCertification: true, marker: "Page 1 of 1" },
    };
  }

  function audit(p: Paper): readonly PaperRuleResult[] {
    const l = p.line;
    const resolution = resolveHmtLine(index, { idText: l.idText, psn: l.psn, hazardClass: l.hazardClass, pg: l.pg });
    return auditPrintedPaper(
      { identity: { pageOf: null, printedPageNumbers: [p.printed.marker] }, hazmat: { lines: [l], emergencyPhone: p.printed.emergencyPhone, shipperCertification: p.printed.shipperCertification } },
      { dataset: ds as never, lines: [{ resolution: resolution as never, ...p.resolved }], ...p.paper },
    ).results;
  }
  return { rows, golden, audit, pgsOfId, index };
}
type Census = ReturnType<typeof census>;

const label = (row: Row, bulk: boolean) => `${row.e.entryId} PG ${row.pg ?? "-"}${bulk ? " bulk" : ""}`;
/** The golden paper with parts of its description changed, the line's own fields following them. */
function reprint(p: Paper, over: Partial<Parts>, line: Partial<PrintedPaperLine> = {}): Paper {
  const parts = { ...p.parts, ...over };
  return {
    ...p,
    parts,
    line: { ...p.line, idText: parts.id, psn: parts.psn, technicalName: parts.tech, hazardClass: parts.cls, pg: parts.pg, descriptionText: printDescription(parts), ...line },
  };
}
const reorder = (p: Paper, order: Piece[]): Paper => ({ ...p, line: { ...p.line, descriptionText: printDescription(p.parts, order) } });
const withLine = (p: Paper, line: Partial<PrintedPaperLine>): Paper => ({ ...p, line: { ...p.line, ...line } });

/**
 * One defect: which rows it applies to, how it breaks the golden paper, the rule that owns it and the reasons it
 * may fail with. `mayWait` names rows where only facts off the paper decide the regulation's exception: the owner
 * may answer cannot_tell there — never pass. `mayPass` is the reason of an exception the regulation itself gives.
 */
interface Defect {
  name: string;
  owner: PaperRuleId | PaperRuleId[];
  reasons: string[];
  applies?: (row: Row, c: Census) => boolean;
  bulk?: boolean;
  make: (p: Paper, row: Row, c: Census) => Paper;
  mayWait?: (row: Row) => boolean;
  mayPass?: string;
}

/** No column 8A in the dataset, or look-alike rows that disagree on it (UN1738 "Benzyl chloride" in 2026.12.0). */
const lqMayWait = ({ lq, twins }: Row) => lq === "not_in_dataset" || new Set(twins.map((t) => t.exceptionsRef == null)).size > 1;

const DEFECTS: Defect[] = [
  {
    name: "id printed without UN/NA", owner: "paper_sequence", reasons: ["elements_missing"],
    make: (p, { e }) => reprint(p, { id: e.idNumber }),
  },
  {
    name: "a packing group no row of the number has", owner: "paper_class_pg_match", reasons: ["class_or_pg_wrong"],
    applies: ({ e }, c) => ROMAN.some((pg) => !c.pgsOfId(e).includes(pg)),
    make: (p, { e }, c) => reprint(p, { pg: ROMAN.find((x) => !c.pgsOfId(e).includes(x))! }),
  },
  {
    name: "packing group left off", owner: ["paper_sequence", "paper_class_pg_match"], reasons: ["elements_missing", "class_or_pg_wrong"],
    applies: ({ pg }) => pg !== null,
    make: (p) => reprint(p, { pg: null }),
  },
  {
    // §172.202(a)(3) with PHMSA 05-0282: a subsidiary the table's column (6) does not list is a wrong class.
    name: "a subsidiary class the table does not list", owner: "paper_class_pg_match", reasons: ["class_or_pg_wrong"],
    applies: ({ e }) => e.hazardClass != null && !e.subsidiaryClasses.includes("9") && !/^1\./.test(e.hazardClass),
    make: (p, { e }) => reprint(p, { cls: `${e.hazardClass} (${[...e.subsidiaryClasses, "9"].join(", ")})` }),
  },
  {
    name: "another hazard class", owner: "paper_class_pg_match", reasons: ["class_or_pg_wrong"],
    // Every row, UN0190 included: its table entry gives no class, but a class outside Class 1 is still wrong.
    make: (p, { e }) => reprint(p, { cls: e.hazardClass === "8" ? "3" : "8" }),
  },
  {
    name: "name before the id", owner: "paper_sequence", reasons: ["out_of_order"],
    make: (p) => reorder(p, ["rq", "psn", "id", "cls", "pg", "mp"]),
  },
  {
    name: "a lot number between the name and the class", owner: "paper_sequence", reasons: ["interspersed"],
    make: (p) => reorder(p, ["rq", "id", "psn", "lot", "cls", "pg", "mp"]),
  },
  {
    name: "no total quantity", owner: "paper_quantity_present", reasons: ["missing"],
    make: (p) => withLine(p, { quantity: { value: null, unit: null }, grossWeightLb: null }),
  },
  {
    name: "a quantity with no unit", owner: "paper_quantity_present", reasons: ["unit_missing"],
    make: (p) => ({ ...withLine(p, { quantity: { value: 10, unit: null }, grossWeightLb: null }), resolved: { ...p.resolved, quantityUnit: null } }),
  },
  {
    name: "no package count", owner: "paper_package_count", reasons: ["count_missing"],
    make: (p) => withLine(p, { packageCount: null, packaging: "drums" }),
  },
  {
    name: "no package type", owner: "paper_package_count", reasons: ["type_missing"],
    make: (p) => withLine(p, { packaging: "2" }),
  },
  {
    name: "a name the table does not give this number", owner: "paper_psn_matches_hmt", reasons: ["psn_not_in_hmt"],
    make: (p, { e }) => reprint(p, { psn: `${e.psnPrinted} concentrate` }),
  },
  {
    name: "G entry without its technical name", owner: "paper_technical_name", reasons: ["missing"],
    applies: ({ e }) => e.symbols.includes("G"),
    make: (p) => reprint(p, { tech: null }),
    // §172.203(k)(2)(iii)/(iv): the n.o.s. name already names a chemical group — whether it is the one "primarily
    // responsible" is a fact about the material; a dataset without the flag cannot say either way.
    mayWait: ({ e }) => e.namesChemicalGroup !== false,
    // §172.203(k)(2)(ii): a sample classed by §172.101(c)(11) needs no technical name ("Samples, explosive").
    mayPass: "excepted_k2ii_sample",
  },
  {
    name: "RQ left off a tank holding the reportable quantity", owner: "paper_rq", reasons: ["rq_not_printed"], bulk: true,
    applies: ({ rqListed }) => rqListed !== null,
    make: (p) => reprint(p, { rq: false }, { hmColumnMark: "X", marks: p.line.marks.filter((m) => m !== "RQ") }),
    // A solution form ("Sodium hydroxide solution") is judged by its printed concentration, which this paper does not print.
    mayWait: ({ rqListed }) => rqListed === "mixture",
  },
  {
    name: "MARINE POLLUTANT left off a tank of an Appendix B material", owner: "paper_marine_pollutant", reasons: ["required_not_printed"], bulk: true,
    applies: ({ mp }) => mp,
    make: (p) => reprint(p, { mp: false }, { marks: p.line.marks.filter((m) => m !== "MARINE POLLUTANT") }),
  },
  {
    name: "Limited Quantity where column 8A allows none", owner: "paper_lq", reasons: ["not_authorised"],
    applies: ({ lq }) => lq !== "authorised",
    make: (p) => withLine(p, { marks: [...p.line.marks, "LTD QTY"], descriptionText: `${p.line.descriptionText}, LTD QTY` }),
    mayWait: lqMayWait,
  },
  {
    name: "Limited Quantity printed before the description", owner: "paper_lq", reasons: ["lq_not_following"],
    applies: ({ lq }) => lq !== "not_authorised",
    make: (p) => withLine(p, { marks: [...p.line.marks, "LTD QTY"], descriptionText: `LTD QTY ${p.line.descriptionText}` }),
    mayWait: lqMayWait,
  },
  {
    name: "no emergency number", owner: "paper_er_phone", reasons: ["missing"],
    make: (p) => ({ ...p, printed: { ...p.printed, emergencyPhone: null } }),
    // §172.604(d)(2) names the materials that need none (battery-powered vehicles, dry ice, engines, …).
    mayPass: "excepted_172_604_d",
  },
  {
    name: "no shipper's certification", owner: "paper_certification", reasons: ["missing"],
    make: (p) => ({ ...p, printed: { ...p.printed, shipperCertification: false } }),
  },
  {
    name: "page 1 of 2 with the second page missing", owner: "paper_page_complete", reasons: ["pages_missing"],
    make: (p) => ({ ...p, printed: { ...p.printed, marker: "Page 1 of 2" } }),
  },
];

for (const version of VERSIONS) {
  describe(`the paper audit over a golden paper for every table row (RC5), dataset ${version}`, () => {
    const ds = loadDataset(version);
    const c = census(ds);
    const known = (row: Row, r: PaperRuleResult) => EXPECTED_WAITS[`${row.e.entryId} ${r.ruleId}`] === r.reason;

    it("covers the whole table", () => {
      expect(c.rows.length).toBeGreaterThan(2_900);
      // The vacuity guard (D-PC1): until 2026-10-26 no entry carried a subsidiary, so every golden paper printed the
      // primary class alone and the parenthesised form §172.202(a)(3) requires was never on any paper here.
      expect(c.rows.filter((r) => r.e.subsidiaryClasses.length > 0).length).toBeGreaterThan(550);
      expect(c.rows.filter((r) => /\(/.test(classText(r.e) ?? "")).length).toBeGreaterThan(550);
      expect(c.rows.filter((r) => r.e.symbols.includes("G")).length).toBeGreaterThan(200);
      expect(c.rows.filter((r) => r.rqListed === "neat").length).toBeGreaterThan(150);
      expect(c.rows.filter((r) => r.mp).length).toBeGreaterThan(100);
      const listed = [...ds.hazSubstances, ...ds.marinePollutants].map((s) => s.nameNormalized);
      for (const n of TECH.toLowerCase().split(", ")) expect(listed).not.toContain(n);
    });

    it("never matches a paper to the look-alike row that excepts more (the placard path's Limited Quantity, P1)", () => {
      // The table matcher names one row of a look-alike group; the placard engine lets Limited Quantity lift a
      // placard only where that row's column 8A excepts. If a group disagrees, the named row must be one that
      // excepts nothing — so a cut that reorders a group can never turn an unexcepted material into an LQ.
      const groups = c.rows.filter((r) => new Set(r.twins.map((t) => t.exceptionsRef == null)).size > 1);
      const wrong = groups.flatMap((row) => {
        const res = resolveHmtLine(c.index, { idText: `${row.e.idPrefix}${row.e.idNumber}`, psn: row.e.psnPrinted, hazardClass: classText(row.e), pg: row.pg });
        const named = res.ok ? row.twins.find((t) => t.entryId === res.entryId) : undefined;
        return named && named.exceptionsRef == null ? [] : [`${row.e.entryId}: matched ${res.ok ? res.entryId : res.reason}`];
      });
      expect(wrong).toEqual([]);
    });

    it("passes every rule on a correctly printed paper, in drums and in a cargo tank", () => {
      const wrong: string[] = [];
      let waits = 0;
      for (const row of c.rows) for (const bulk of [false, true]) {
        for (const r of c.audit(c.golden(row, bulk))) {
          if (r.outcome === "pass") continue;
          if (known(row, r)) waits++;
          else wrong.push(`${label(row, bulk)}: ${r.ruleId} ${r.outcome} ${r.reason}`);
        }
      }
      expect(wrong.slice(0, 15), `${wrong.length} results`).toEqual([]);
      // Each pinned wait still happens, in drums and in a tank: a fix that removes one removes it from EXPECTED_WAITS.
      expect(waits).toBe(Object.keys(EXPECTED_WAITS).length * 2);
    }, 120_000);

    for (const d of DEFECTS) {
      it(`fails only its own rule: ${d.name}`, () => {
        const owners = [d.owner].flat();
        const wrong: string[] = [];
        let failed = 0;
        const rows = c.rows.filter((r) => d.applies?.(r, c) ?? true);
        for (const row of rows) {
          const at = label(row, d.bulk ?? false);
          for (const r of c.audit(d.make(c.golden(row, d.bulk ?? false), row, c))) {
            if (owners.includes(r.ruleId)) {
              if (r.outcome === "pass" && r.reason !== d.mayPass) wrong.push(`MISSED ${at}: ${r.ruleId} passed (${r.reason})`);
              else if (r.outcome === "fail" && !d.reasons.includes(r.reason)) wrong.push(`${at}: ${r.ruleId} failed for ${r.reason}`);
              else if (r.outcome === "cannot_tell" && !d.mayWait?.(row)) wrong.push(`${at}: ${r.ruleId} waits (${r.reason})`);
              else if (r.outcome === "fail") failed++;
            } else if (r.outcome === "fail") wrong.push(`FALSE WRONG ${at}: ${r.ruleId} ${r.reason}`);
          }
        }
        expect(wrong.slice(0, 15), `${wrong.length} of ${rows.length} rows`).toEqual([]);
        expect(rows.length).toBeGreaterThan(0);
        // A defect that only ever waits or is excepted checks nothing: most rows it applies to must fail outright —
        // except where the dataset does not carry what the rule needs.
        if (!rows.every((r) => d.mayWait?.(r))) expect(failed, `${failed} of ${rows.length} rows failed`).toBeGreaterThan(rows.length / 2);
      }, 120_000);
    }
  });
}
