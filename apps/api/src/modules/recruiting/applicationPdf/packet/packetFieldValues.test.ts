import { describe, it, expect } from "vitest";
import type { DriverApplication } from "@silvicom/shared";
import { packetFieldFill } from "./packetFieldValues.js";
import type { PacketFieldInput } from "./packetGrid.js";
import { PACKET_FIELD_LINES, PACKET_MARK_SIDE_LINES, fieldTableRowCount } from "./packetFieldGeometry.js";
import { PACKET_SIGNING_FIELD_LINES } from "./packetSigningGeometry.js";

/**
 * The applicant's answers, matched onto the carrier's paper.
 *
 * ⚠ **What is worth pinning here is the REFUSALS**, not the happy path — a fill that puts a date of
 * birth on the date-of-birth line is checkable by looking at the rendered page and was. What a test
 * has to hold still is the set of things that would produce a document which is signed, filed and
 * wrong: a fourth accident silently dropped, a Social Security number appearing, a date printed on a
 * line whose signature has not been made, one date printed on thirteen lines.
 */

const BASE = {
  first_name: "Marija", middle_name: "Ana", last_name: "Varmeda",
  date_of_birth: "1980-04-01", email: "m@example.test", phone: "(555) 011-1234",
  other_names: [],
  addresses: [{ line1: "1301 Armitage Ave", city: "Melrose Park", state: "IL", postal_code: "60160" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_class: "A", cdl_expires_at: "2029-01-01",
  additional_licences: [],
  equipment_experience: [],
  accidents: [], declares_no_accidents: true,
  violations: [], declares_no_violations: true,
  licence_ever_denied: false,
  employers: [], declares_no_employment: true,
  questionnaire_answers: {},
  certified: true, signed_name: "Marija Varmeda",
} as unknown as DriverApplication;

const fill = (over: Partial<Record<string, unknown>> = {}, input: Partial<PacketFieldInput> = {}) =>
  packetFieldFill({
    application: { ...BASE, ...over } as DriverApplication,
    certifiedAt: "2026-09-14T09:00:00Z",
    markedAt: {},
    signedName: "Marija Varmeda",
    ...input,
  });

const textAt = (r: ReturnType<typeof fill>, id: string): string | undefined =>
  r.placed.find((p) => p.line.id === id)?.text;

describe("the answers that go on the carrier's pages", () => {
  it("puts the plain page-1 answers where the geometry says", () => {
    const r = fill({ questionnaire_answers: { position: "OTR driver", heard_from: "Indeed" } });
    expect(textAt(r, "p01.date")).toBe("09/14/2026");
    expect(textAt(r, "p01.dob")).toBe("04/01/1980");
    expect(textAt(r, "p01.position")).toBe("OTR driver");
    expect(textAt(r, "p01.cdl")).toBe("PA334554 (PA)");
    expect(textAt(r, "p01.heard_from")).toBe("Indeed");
  });

  /** ⚠ Every placed value must name a line the geometry really has, or it is drawn nowhere. */
  it("never places a value on an id the geometry does not carry", () => {
    const known = new Set([
      ...PACKET_FIELD_LINES.map((l) => l.id),
      ...PACKET_MARK_SIDE_LINES.map((l) => l.id),
      // ⚠ The signing pages' own table (AUD-17). It is listed here rather than reached through
      // `packetFieldIdsUsed()` because that function is the thing under test on the line below.
      ...PACKET_SIGNING_FIELD_LINES.map((l) => l.id),
    ]);
    const r = fill({
      accidents: [{ occurred_on: "2024-03-03", nature: "Rear-end", fatalities: 0, injuries: 1, hazmat_spill: false }],
      declares_no_accidents: false,
    });
    for (const p of r.placed) {
      // Grid cells and page-1's caption columns are synthesised and carry their own ids.
      if (/\.r\d+\.c\d+$/.test(p.line.id) || /^p01\.(name|address)\./.test(p.line.id)) continue;
      expect(known.has(p.line.id), p.line.id).toBe(true);
    }
  });

  /**
   * ⚠ **D-HIRE6, asserted over the OUTPUT rather than over the table.** The geometry carries no SSN
   * line, but a mapping could still put nine digits into some other cell — so this looks at every
   * string that would be drawn.
   */
  it("never places anything that looks like a Social Security number", () => {
    const r = fill({ questionnaire_answers: { position: "OTR" } });
    for (const p of r.placed) expect(p.text).not.toMatch(/\d{3}-?\d{2}-?\d{4}/);
    expect(r.placed.some((p) => /ssn|social/i.test(p.line.id))).toBe(false);
  });
});

/**
 * ⚠ **The refusals that keep a filed form true.** §391.21(b)(7)–(9) asks for ALL accidents and
 * convictions in the period and the carrier gives each grid three lines. A renderer that drew three
 * and dropped the fourth would produce a document that is signed, filed and materially false.
 */
describe("what does not fit comes back rather than disappearing", () => {
  const accident = (n: number) => ({
    occurred_on: `2024-0${n}-01`, nature: `Incident ${n}`, fatalities: 0, injuries: 0, hazmat_spill: false,
  });

  it("places the three accidents the form has room for and returns the rest", () => {
    const r = fill({ accidents: [1, 2, 3, 4, 5].map(accident), declares_no_accidents: false });
    const cells = r.placed.filter((p) => p.line.id.startsWith("p02.accidents."));
    expect(new Set(cells.map((p) => p.line.y)).size).toBe(fieldTableRowCount("p02.accidents"));

    const over = r.overflow.find((o) => o.tableId === "p02.accidents");
    expect(over, "the two that did not fit").toBeDefined();
    expect(over!.rows).toHaveLength(2);
    expect(over!.rows.map((cells2) => cells2[1])).toEqual(["Incident 4", "Incident 5"]);
    expect(over!.label).toMatch(/accident/i);
  });

  /** ⚠ The carrier's licence grid has ONE row, which is the tightest ceiling in the packet. */
  it("returns a second licence rather than drawing over the first", () => {
    const r = fill({
      additional_licences: [{ issuing_authority: "IL", number: "IL99", kind: "B", expires_at: "2030-01-01" }],
    });
    expect(textAt(r, "p02.licences.r0.c1")).toBe("PA334554");
    const over = r.overflow.find((o) => o.tableId === "p02.licences")!;
    expect(over.rows).toEqual([["IL", "IL99", "B", "01/01/2030"]]);
  });

  /**
   * ⚠ The experience grid's four rows are the carrier's PRINTED classes, so a second entry for a
   * class that already has one has nowhere to go — it is overflow, not a lost answer, and column 0
   * is never written into because the carrier already wrote it.
   */
  it("folds experience onto the printed class rows and returns the second of a class", () => {
    const r = fill({
      equipment_experience: [
        { equipment_class: "tractor_semi_trailer", equipment_type: "Van", from: "2019", to: 2026, approx_miles: 480000 },
        { equipment_class: "tractor_semi_trailer", equipment_type: "Reefer", from: "2015", to: 2019, approx_miles: 90000 },
      ],
    });
    expect(textAt(r, "p02.experience.r1.c1")).toBe("Van");
    // ⚠ Column 0 is the carrier's printed class label and is never written over. The fixture carries
    // a non-empty value there precisely so this assertion can fail — with an empty one it passed
    // whether the guard existed or not, which is how it shipped vacuous for one round.
    expect(r.placed.some((p) => p.line.id === "p02.experience.r1.c0")).toBe(false);

    const over = r.overflow.find((o) => o.tableId === "p02.experience")!;
    expect(over.rows[0]![1]).toBe("Reefer");
    // ⚠ And the overflow row DOES carry the class, because a continuation sheet has no printed
    // column 0 to read it from.
    expect(over.rows[0]![0]).toBe("TRACTOR - SEMI TRAILER");
  });

  it("returns a fourth address rather than dropping it", () => {
    const addresses = [1, 2, 3, 4, 5].map((n) => ({
      line1: `${n} Some St`, city: "Joliet", state: "IL", postal_code: "60432",
    }));
    const r = fill({ addresses });
    const over = r.overflow.find((o) => o.tableId === "p01.residency")!;
    expect(over.rows).toHaveLength(1);
    expect(over.rows[0]![0]).toBe("5 Some St");
  });

  it("has nothing to overflow when the driver declared none", () => {
    const r = fill({ accidents: [], declares_no_accidents: true, violations: [], declares_no_violations: true });
    expect(r.overflow.filter((o) => /accidents|convictions/.test(o.tableId))).toEqual([]);
    expect(r.placed.some((p) => p.line.id.startsWith("p02.accidents."))).toBe(false);
  });

  /**
   * ⚠ `declares_no_accidents` is an ANSWER, not an omission — so a payload that declares none while
   * also carrying rows must print nothing, the way `renderPacket.ts` read it. The declaration wins.
   */
  it("prints nothing when the driver declared none, even if rows are present", () => {
    const r = fill({ accidents: [accident(1)], declares_no_accidents: true });
    expect(r.placed.some((p) => p.line.id.startsWith("p02.accidents."))).toBe(false);
    expect(r.overflow.some((o) => o.tableId === "p02.accidents")).toBe(false);
  });
});

describe("the two licence-history questions", () => {
  it("marks Yes on both when the licence was ever denied, and explains under A", () => {
    const r = fill({ licence_ever_denied: true, licence_denial_detail: "Denied 2011, reinstated 2012" });
    expect(textAt(r, "p02.denied.yes")).toBe("X");
    expect(textAt(r, "p02.revoked.yes")).toBe("X");
    expect(textAt(r, "p02.denied.no")).toBeUndefined();
    expect(textAt(r, "p02.denied.explain")).toBe("Denied 2011, reinstated 2012");
  });

  it("marks No on both when it was not, and explains nothing", () => {
    const r = fill({ licence_ever_denied: false });
    expect(textAt(r, "p02.denied.no")).toBe("X");
    expect(textAt(r, "p02.revoked.no")).toBe("X");
    expect(textAt(r, "p02.denied.yes")).toBeUndefined();
    expect(textAt(r, "p02.denied.explain")).toBeUndefined();
  });
});

/**
 * ⚠ **The dates beside the signatures — each its OWN stop's.** The walk is twenty-two acts and a
 * driver who loses signal finishes tomorrow; one date on thirteen lines would assert that thirteen
 * signatures were made at a moment twelve of them were not.
 */
describe("the date beside each signature", () => {
  it("gives each stop the date that stop was signed on, not one date for all of them", () => {
    const r = fill({}, { markedAt: { p03: "2026-09-14T10:00:00Z", p18: "2026-09-15T08:30:00Z" } });
    expect(textAt(r, "p03.date")).toBe("09/14/2026");
    expect(textAt(r, "p18.date")).toBe("09/15/2026");
  });

  /** ⚠ A line whose signature has not been made gets NO date — a half-signed packet is a real state. */
  it("leaves a stop that has not been signed undated", () => {
    const r = fill({}, { markedAt: { p03: "2026-09-14T10:00:00Z" } });
    expect(textAt(r, "p03.date")).toBe("09/14/2026");
    expect(textAt(r, "p18.date")).toBeUndefined();
    expect(textAt(r, "p19a.date")).toBeUndefined();
  });

  it("dates every one of them when the whole packet is signed", () => {
    const every = Object.fromEntries(
      PACKET_MARK_SIDE_LINES.map((l) => [l.placementId, "2026-09-14T10:00:00Z"]),
    );
    const r = fill({}, { markedAt: every });
    const dated = PACKET_MARK_SIDE_LINES.filter((l) => l.kind === "date");
    expect(dated.length).toBe(13);
    for (const l of dated) expect(textAt(r, l.id), l.id).toBe("09/14/2026");
  });

  /**
   * Page 22 asks for the name in block capitals beside the mark.
   *
   * ⚠ **The applicant's NAME, not their adopted signature — AUD-18, 2026-09-19, a correction.** The
   * caption is `Driver name Print`; the signature is on the line beside it. Reading `signed_name`
   * here made one packet print two spellings of one person, because page 15's `Name of applicant`
   * had always read the payload. `signedName` is deliberately passed as something DIFFERENT below,
   * so a revert to it fails rather than coincidentally agreeing.
   */
  it("puts the applicant's own name on page 22's printed-name line", () => {
    const r = fill({}, { signedName: "M Varmeda" });
    expect(textAt(r, "p22.printed_name")).toBe("Marija Ana Varmeda");
    expect(textAt(r, "p15.name")).toBe("Marija Ana Varmeda");
  });

  /** ⚠ Page 15's date is when the RELEASE was given, which is that page's own mark. */
  it("dates page 15 from its own stop rather than from the certification", () => {
    const r = fill({}, { markedAt: { p15: "2026-09-16T12:00:00Z" } });
    expect(textAt(r, "p15.date")).toBe("09/16/2026");
  });

  /** ⚠ `Sent to` stays blank until Q-PKT11 is answered, and the absence is asserted so it stays so. */
  it("leaves page 15's `Sent to` blank", () => {
    const r = fill({}, { markedAt: { p15: "2026-09-16T12:00:00Z" } });
    expect(r.placed.some((p) => /sent/i.test(p.line.id))).toBe(false);
  });
});

describe("free text on page 16's three ruled lines", () => {
  it("wraps by word across the lines and never splits one", () => {
    const training = "Hazmat endorsement 2021. Tanker endorsement 2023. Defensive driving refresher, Smith System, 2024.";
    const r = fill({ questionnaire_answers: { other_training: training } });
    const lines = [1, 2, 3].map((i) => textAt(r, `p16.training.${i}`)).filter(Boolean) as string[];
    expect(lines.length).toBeGreaterThan(1);
    // ⚠ Every word survives, in order, and none is cut in half.
    expect(lines.join(" ").split(/\s+/)).toEqual(training.split(/\s+/));
  });

  it("returns whatever is longer than three lines rather than truncating it", () => {
    const long = Array.from({ length: 60 }, (_, i) => `training-item-${i}`).join(" ");
    const r = fill({ questionnaire_answers: { other_training: long } });
    const over = r.overflow.find((o) => o.tableId === "p16.training");
    expect(over, "training past three lines").toBeDefined();
    const placedWords = [1, 2, 3]
      .map((i) => textAt(r, `p16.training.${i}`) ?? "")
      .join(" ")
      .trim()
      .split(/\s+/);
    const overWords = over!.rows.flat().join(" ").split(/\s+/);
    expect([...placedWords, ...overWords]).toEqual(long.split(/\s+/));
  });
});

/**
 * ⚠ `driver_applications.payload` is historical jsonb and append-only: a row filed before a field
 * existed has none of it. A derivative that throws on an old payload is a qualification file that
 * cannot be produced, which is the §390.32(d) failure this whole module exists inside.
 */
describe("a payload from before half these fields existed", () => {
  it("produces a document rather than throwing", () => {
    const ancient = {
      first_name: "Susan", last_name: "Godfrey", date_of_birth: "1979-02-02",
      addresses: [], accidents: [], violations: [], employers: [],
      certified: true, signed_name: "Susan Godfrey",
    } as unknown as DriverApplication;
    const r = packetFieldFill({
      application: ancient, certifiedAt: "2026-09-14T09:00:00Z", markedAt: {}, signedName: "Susan Godfrey",
    });
    expect(r.placed.length).toBeGreaterThan(0);
    expect(textAt(r, "p01.dob")).toBe("02/02/1979");
    // Nothing invented for the questions it was never asked.
    expect(textAt(r, "p01.position")).toBeUndefined();
    expect(textAt(r, "p01.heard_from")).toBeUndefined();
  });

  it("places no empty strings, so a blank answer leaves the carrier's line blank", () => {
    const r = fill({ questionnaire_answers: { position: "", heard_from: "   " } });
    for (const p of r.placed) expect(p.text.trim()).not.toBe("");
  });
});

/**
 * D-PKT14 — the filler on page 16's two optional lists.
 *
 * ⚠ **What these hold still is WHERE IT STOPS.** That an empty education grid prints `N/A` is the
 * owner's ruling and is easy; that page 12's employment log and the accident and conviction grids
 * do NOT is the part a future tidy-up would helpfully "fix", and it is the part that would put a
 * second assertion on a regulated page beside the declaration the applicant actually ticked.
 */
describe("page 16's unused lines (D-PKT14)", () => {
  const cells = (r: ReturnType<typeof fill>, tableId: string): string[] =>
    r.placed.filter((p) => p.line.id.startsWith(`${tableId}.r`)).map((p) => p.text);

  const rowsOfTable = (r: ReturnType<typeof fill>, tableId: string): Set<string> =>
    new Set(
      r.placed
        .filter((p) => p.line.id.startsWith(`${tableId}.r`))
        .map((p) => p.line.id.split(".")[2]!),
    );

  it("fills every cell of every unused education and reference row", () => {
    const r = fill({ questionnaire_answers: {} });
    // Four printed rows × five columns, three printed rows × three columns — the carrier's counts.
    expect(cells(r, "p16.education")).toEqual(Array(fieldTableRowCount("p16.education") * 5).fill("N/A"));
    expect(cells(r, "p16.references")).toEqual(Array(fieldTableRowCount("p16.references") * 3).fill("N/A"));
  });

  it("leaves a used row alone and fills only the rows after it", () => {
    const r = fill({
      questionnaire_answers: {
        references: [{ full_name: "Ivan Kovac", years_known: "6", phone: "(555) 010-2000" }],
      },
    });
    expect(cells(r, "p16.references").slice(0, 3)).toEqual(["Ivan Kovac", "6", "(555) 010-2000"]);
    // Two rows left, three cells each.
    expect(cells(r, "p16.references").slice(3)).toEqual(Array(6).fill("N/A"));
  });

  /**
   * ⚠ Counted from the number of rows the applicant supplied, not from the last row carrying text.
   * A reference with a name and no phone is a row they USED, and `N/A` in the phone cell would
   * contradict the name beside it.
   */
  it("does not fill the empty cells of a row the applicant part-filled", () => {
    const r = fill({
      questionnaire_answers: { references: [{ full_name: "Ivan Kovac", years_known: "", phone: "" }] },
    });
    const firstRow = r.placed.filter((p) => p.line.id.startsWith("p16.references.r0"));
    expect(firstRow.map((p) => p.text)).toEqual(["Ivan Kovac"]);
  });

  /**
   * ⚠ **The case that found the defect, and it is the shape the web form actually produces.**
   * `emptyReference()` opens the list with one blank row, so an applicant who types into the second
   * one sends `[blank, filled]`. Neither index rule survives it: counting from `rows.length` prints
   * row 0 blank, and counting from the rows that carry text writes `N/A` over the name in row 1.
   * The filler is decided per row for this reason.
   */
  it("fills a blank row the applicant skipped, without touching the filled row after it", () => {
    const r = fill({
      questionnaire_answers: {
        references: [
          { full_name: "", years_known: "", phone: "" },
          { full_name: "Ivan Kovac", years_known: "6", phone: "(555) 010-2000" },
        ],
      },
    });
    const row = (n: number) =>
      r.placed.filter((p) => p.line.id.startsWith(`p16.references.r${n}.`)).map((p) => p.text);
    expect(row(0)).toEqual(["N/A", "N/A", "N/A"]);
    expect(row(1)).toEqual(["Ivan Kovac", "6", "(555) 010-2000"]);
    expect(row(2)).toEqual(["N/A", "N/A", "N/A"]);
  });

  it("prints no filler when the applicant used every printed row", () => {
    const refs = Array.from({ length: fieldTableRowCount("p16.references") }, (_, i) => ({
      full_name: `Referee ${i + 1}`, years_known: "5", phone: "(555) 010-0000",
    }));
    const r = fill({ questionnaire_answers: { references: refs } });
    expect(cells(r, "p16.references")).not.toContain("N/A");
  });

  /**
   * ⚠ **The refusal, and the reason this describe block exists.** Every one of these grids answers a
   * §391.21(b)(7)–(10) question that has its OWN declaration — `declares_no_accidents`,
   * `declares_no_violations`, `declares_no_employment` — all three of which `BASE` ticks. An empty
   * grid here is already answered on the paper; `N/A` across it would be a second answer.
   */
  it("prints no filler on any regulated grid, even with every one of them empty", () => {
    const r = fill({ questionnaire_answers: {} });
    // ⚠ Asserted as "carries no filler" rather than "is empty": `BASE` holds a CDL, so p02's
    // one-row licence table is legitimately full. Emptiness is a fact about this fixture; the
    // absence of `N/A` is the fact about the rule.
    for (const tableId of ["p12.employment", "p02.licences", "p02.accidents", "p02.violations"]) {
      expect({ tableId, filler: cells(r, tableId).filter((t) => t === "N/A") }).toEqual({
        tableId,
        filler: [],
      });
    }
  });

  /** The filler must not invent rows the carrier did not print. */
  it("never fills past the rows the carrier's form has", () => {
    const r = fill({ questionnaire_answers: {} });
    expect(rowsOfTable(r, "p16.education").size).toBe(fieldTableRowCount("p16.education"));
    expect(rowsOfTable(r, "p16.references").size).toBe(fieldTableRowCount("p16.references"));
  });
});
