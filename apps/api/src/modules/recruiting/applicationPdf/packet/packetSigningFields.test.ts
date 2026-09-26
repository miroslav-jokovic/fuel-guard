import { describe, it, expect } from "vitest";
import type { DriverApplication } from "@silvicom/shared";
import { packetFieldFill, packetFieldIdsUsed } from "./packetFieldValues.js";
import type { PacketFieldInput, PlacedFieldValue } from "./packetGrid.js";
import {
  PACKET_SIGNING_FIELD_LINES,
  SINGLE_LICENCE_BLOCK_FIELDS,
  SINGLE_LICENCE_BLOCK_PAGES,
} from "./packetSigningGeometry.js";

/**
 * What the driver writes about themselves on the pages they sign (AUD-17).
 *
 * ⚠ **What is worth pinning is the REFUSALS, not the happy path.** That a name lands on a name line
 * is checkable by looking at the rendered page, and was. What a test has to hold still is the set of
 * things that would produce a document signed, filed and wrong: a §40.25(j) answer ticked for an
 * applicant who never gave one, a date printed beside a signature nobody has made yet, a name on a
 * page the applicant does not sign, and one packet printing two different spellings of one person.
 */

const BASE = {
  first_name: "Marija",
  middle_name: "Ana",
  last_name: "Varmeda",
  date_of_birth: "1980-04-01",
  other_names: [],
  email: "m@example.test",
  phone: "(555) 011-1234",
  addresses: [
    { line1: "1301 Armitage Ave", line2: "Unit 4", city: "Melrose Park", state: "IL", postal_code: "60160" },
    { line1: "9 Old Road", city: "Aurora", state: "WI", postal_code: "53210" },
  ],
  cdl_number: "PA334554",
  cdl_state: "PA",
  cdl_class: "A",
  cdl_expires_at: "2029-01-01",
  additional_licences: [],
  equipment_experience: [],
  accidents: [],
  declares_no_accidents: true,
  violations: [],
  declares_no_violations: true,
  licence_ever_denied: false,
  employers: [],
  declares_no_employment: true,
  prior_failed_pre_employment_test: false,
  questionnaire_answers: {},
  certified: true,
  signed_name: "Marija Varmeda",
} as unknown as DriverApplication;

/** ⚠ Every stop signed, so that a missing value is a missing value rather than an unsigned page. */
const ALL_MARKED = Object.fromEntries(
  ["p22", "p27", "p28", "p15", "p03"].map((id) => [id, "2026-09-14T10:00:00Z"]),
);

const fill = (over: Record<string, unknown> = {}, input: Partial<PacketFieldInput> = {}) =>
  packetFieldFill({
    application: { ...BASE, ...over } as DriverApplication,
    certifiedAt: "2026-09-14T09:00:00Z",
    markedAt: ALL_MARKED,
    signedName: "Marija Varmeda",
    ...input,
  });

const textAt = (r: { placed: PlacedFieldValue[] }, id: string): string | undefined =>
  r.placed.find((p) => p.line.id === id)?.text;

describe("the signing pages carry what we already hold", () => {
  it("leaves no measured signing line empty for a complete application", () => {
    // ⚠ An OWNER-OPERATOR is the only applicant for whom every line is theirs (Q-HM14): a company
    // driver's page 31 owner-operator half and page 22's contracting reason are blank on purpose.
    const r = fill({ questionnaire_answers: { applying_as: "owner_operator" } });
    const empty = PACKET_SIGNING_FIELD_LINES.map((l) => l.id).filter(
      (id) =>
        // ⚠ Exactly one of the two page-26 ticks is drawn; the other being absent is the answer. And
        // page 4's name is blank on purpose (L-1) — asserted by its own test below — as is page 22's
        // date (D-PKT19), which a withdrawn page never gains.
        id !== "p26.prior_test.yes" && id !== "p04.printed_name" && id !== "p22.date" && textAt(r, id) === undefined,
    );
    expect(empty).toEqual([]);
  });

  it("counts the signing table into the ids the renderer consumes", () => {
    const used = packetFieldIdsUsed();
    for (const l of PACKET_SIGNING_FIELD_LINES) expect(used, l.id).toContain(l.id);
  });
});

/**
 * ⚠ **AUD-18 — one person, one spelling, on one document.**
 *
 * `signed_name` is how somebody SIGNS (D-APP8's mark of record); the payload's `first / middle /
 * last` is what they are CALLED. Before this, page 15's `Name of applicant` printed the payload's
 * `Marija Ana Varmeda` while page 22's `Driver name Print` printed the signature's `Marija Varmeda`
 * — and AUD-17 was about to add five more name lines on one side or the other of that disagreement.
 */
describe("every printed-name line prints the same name", () => {
  it("prints the applicant's name and not their adopted signature", () => {
    const r = fill({}, { signedName: "M Varmeda" });
    const nameLines = [
      "p03.printed_name",
      "p10.printed_name",
      "p26.name",
      "p28.driver_owner_name",
      "p31.driver_name",
      "p31.owner_operator_name",
      // ⚠ AUD-7's mid-sentence blank. It is page 31's THIRD name and belongs in this list rather
      // than in a test of its own, because the failure it guards against is the one this whole
      // block exists for: a name line added on the wrong side of the `signed_name` / payload split.
      "p31.aka_op",
      // ⚠ Page 15's `Name of applicant` is its identity block and stays filled under D-PKT19.
      "p15.name",
      // ⚠ Page 22's `Driver name Print` was in this list until D-PKT19 (2026-09-25) withdrew the
      // page from signing; it prints blank now — see below.
    ];
    for (const id of nameLines) expect(textAt(r, id), id).toBe("Marija Ana Varmeda");
  });

  /**
   * ⚠ L-1: page 4 is withdrawn from signing, so its `Print name` stays blank. A name printed in the
   * block beside a line nobody signed asserts the half of the act that did not happen — page 24's
   * lesson (D-PKT10), met on the page counsel is being asked about.
   */
  it("prints no name in the block of a page withdrawn from signing", () => {
    const r = fill({}, { signedName: "M Varmeda" });
    // ⚠ D-PKT19: page 22 is a permission signed on the link, and blank for the same reason.
    for (const id of ["p04.printed_name", "p22.printed_name"]) expect(textAt(r, id), id).toBeUndefined();
    expect(textAt(r, "p03.printed_name")).toBe("Marija Ana Varmeda");
  });

  /**
   * AUD-7: the blank inside `I ______ aka (OP) read and understood the agreement above.`
   *
   * ⚠ **A TEXT assertion cannot see what was wrong with this line, and could not have found it.**
   * The defect was that nothing was drawn at all, and "page 31 does not contain the name" was false
   * before the fix too — `Driver name:` and `Owner Operator Name:` both carried it. What identifies
   * this blank is its POSITION, which is why the assertion is on the line id and why the geometry
   * half lives next door in `packetSigningGeometry.test.ts`.
   *
   * ⚠ **The discriminator is that it is a DIFFERENT line from the other two**, not merely that some
   * line on page 31 has the name. A filler that pushed the name to `p31.driver_name` twice would
   * satisfy a page-level check and leave the sentence blank, which is the defect.
   */
  it("names the owner-operator inside the sentence that declares they read it", () => {
    const r = fill({});
    const ids = ["p31.aka_op", "p31.driver_name", "p31.owner_operator_name"];
    for (const id of ids) expect(textAt(r, id), id).toBe("Marija Ana Varmeda");
    const lines = ids.map((id) => r.placed.find((v) => v.line.id === id)!.line);
    expect(new Set(lines.map((l) => `${l.x1}|${l.y}`)).size, "three blanks, three places").toBe(3);
    // ⚠ `Witness Name:` is a third person (`p31w`) and must stay empty however the rest is filled.
    expect(r.placed.some((v) => v.line.id.includes("witness"))).toBe(false);
  });

  it("drops a middle name it does not have rather than printing two spaces", () => {
    const r = fill({ middle_name: null });
    expect(textAt(r, "p03.printed_name")).toBe("Marija Varmeda");
  });
});

describe("the dates that stand alone on a signing page", () => {
  /**
   * ⚠ **A stop with no mark gets NO date**, rather than today's. A half-signed packet is a real
   * state (0339) and a date beside a signature nobody has made yet is the document asserting
   * something that has not happened.
   */
  it("dates only the stops that have actually been signed", () => {
    const r = fill({}, { markedAt: { p27: "2026-09-16T12:00:00Z" } });
    expect(textAt(r, "p27.date")).toBe("09/16/2026");
    expect(textAt(r, "p22.date")).toBeUndefined();
    expect(textAt(r, "p28.date")).toBeUndefined();
  });

  /** ⚠ Each stop's OWN `signed_at`, never `certifiedAt` and never one stamp across all of them. */
  it("gives each page the day that page was signed", () => {
    const r = fill({}, {
      markedAt: { p22: "2026-09-14T10:00:00Z", p27: "2026-09-15T10:00:00Z", p28: "2026-09-16T10:00:00Z" },
    });
    // ⚠ Page 22's date stays blank even with a mark in hand: D-PKT19 (2026-09-25) withdrew the page,
    // and a date beside a signature that is not drawn is half an act.
    expect([textAt(r, "p22.date"), textAt(r, "p27.date"), textAt(r, "p28.date")]).toEqual([
      undefined,
      "09/15/2026",
      "09/16/2026",
    ]);
  });

  /**
   * ⚠ **The signature date is the UTC calendar day, not the reader's.** `markedAt` is a `timestamptz`,
   * and when the packet moved to `MM/DD/YYYY` on 2026-09-20 the obvious call — handing the instant
   * straight to `formatDisplayDate` — silently made the printed date depend on the zone of whatever
   * process drew the PDF. It passed every test in this file, because they all use mid-morning UTC
   * stamps that fall on the same day in every US zone.
   *
   * This one does: 02:30 UTC is the PREVIOUS evening in Chicago. The instant has to sit in the early
   * UTC hours to discriminate at all — an afternoon stamp like the 10:00Z ones above falls on the same
   * calendar day in every US zone, which is exactly why the whole file missed this. Production runs in
   * UTC so the fault would never have shown there; it would have appeared only on a packet regenerated
   * from a laptop — a federal form dated a day off, from a code path nobody was watching.
   */
  it("dates a signature by the UTC day even when the drawing process is in another zone", () => {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
    expect(env, "this test needs process.env.TZ to pin a timezone").toBeDefined();
    const wasTz = env!.TZ;
    env!.TZ = "America/Chicago";
    try {
      // The trap, named: this instant is the 16th in UTC and the 15th on the local clock. If this
      // line ever stops holding, the zone pin has stopped working and the assertion under it is
      // testing nothing — which is the state this test was born in.
      expect(new Date("2026-09-16T02:30:00Z").getDate()).toBe(15);
      const r = fill({}, { markedAt: { p27: "2026-09-16T02:30:00Z" } });
      expect(textAt(r, "p27.date")).toBe("09/16/2026");
    } finally {
      env!.TZ = wasTz;
    }
  });
});

/**
 * Page 26 asks §40.25(j)'s two-year question, and it is the only box in the packet.
 *
 * ⚠ **An unanswered one ticks NEITHER half.** The field arrived with P8 and `driver_applications` is
 * append-only, so a packet filed before it can never gain an answer — and ticking `NO` on its behalf
 * would answer a mandatory federal question the applicant never answered, inside a document they
 * have signed.
 */
describe("page 26's two-year question", () => {
  it("ticks NO alone when the applicant answered no", () => {
    const r = fill({ prior_failed_pre_employment_test: false });
    expect(textAt(r, "p26.prior_test.no")).toBe("X");
    expect(textAt(r, "p26.prior_test.yes")).toBeUndefined();
  });

  it("ticks YES alone when the applicant answered yes", () => {
    const r = fill({ prior_failed_pre_employment_test: true });
    expect(textAt(r, "p26.prior_test.yes")).toBe("X");
    expect(textAt(r, "p26.prior_test.no")).toBeUndefined();
  });

  it("ticks neither box for a payload filed before the question existed", () => {
    const r = fill({ prior_failed_pre_employment_test: undefined });
    expect(textAt(r, "p26.prior_test.yes")).toBeUndefined();
    expect(textAt(r, "p26.prior_test.no")).toBeUndefined();
  });
});

describe("the identity block pages 18 and 19 both ask for", () => {
  it("fills all eight fields on both pages, from the CURRENT address", () => {
    const r = fill();
    for (const page of SINGLE_LICENCE_BLOCK_PAGES) {
      expect(SINGLE_LICENCE_BLOCK_FIELDS.map((f) => textAt(r, `p${page}.${f}`))).toEqual([
        "Marija Ana Varmeda",
        // ⚠ `line2` joined onto the street, the way page 1's residency grid reads it — an address
        // that loses its unit number is a different address.
        "1301 Armitage Ave, Unit 4",
        "Melrose Park",
        "IL",
        "60160",
        "PA334554",
        "PA",
        "01/01/2029",
      ]);
    }
  });

  /**
   * ⚠ **The licence number ALONE, unlike page 1's.** `p01.cdl` appends the state in brackets because
   * page 1 has no separate `State:` rule for the licence; this block has one at x360.5, so the same
   * string here would print the state twice on one row.
   */
  it("does not repeat the licence state inside the licence number", () => {
    const r = fill();
    expect(textAt(r, "p18.cdl")).toBe("PA334554");
    expect(textAt(r, "p18.cdl_state")).toBe("PA");
  });

  it("produces an empty block rather than throwing for a payload with no address", () => {
    const r = fill({ addresses: [] });
    expect(textAt(r, "p18.city")).toBeUndefined();
    expect(textAt(r, "p18.driver_name")).toBe("Marija Ana Varmeda");
  });
});

/**
 * ⚠ **Asserted through the FILL, not only through the geometry.** `packetSigningGeometry.test.ts`
 * holds that nothing is MEASURED on those pages; this holds that nothing is DRAWN there, which is
 * the claim D-PKT1 actually makes and the one a future grid or overflow block could break without
 * touching the geometry at all.
 */
describe("nothing reaches a page that is not the applicant's document", () => {
  it("places no value on pages 14, 21, 23 or 24", () => {
    const r = fill();
    const strays = r.placed.filter((p) => [14, 21, 23, 24].includes(p.line.page));
    expect(strays.map((p) => p.line.id)).toEqual([]);
  });
});

/**
 * Q-HM14 (ruled (b), 2026-09-24): page 22's reason and page 31's owner-operator half, from the
 * applicant's structured `applying_as`.
 *
 * ⚠ **What is pinned is the three states, not two.** The null case is every packet filed before the
 * question existed and every applicant who left it blank, and it must print exactly what the paper
 * printed before this — owner-operator names, no reason ticked — because either change would be the
 * document answering a question on the applicant's behalf.
 */
describe("what page 22 and page 31 print from `applying_as`", () => {
  const OP_NAMES = ["p31.owner_operator_name", "p31.aka_op"];

  it("prints neither owner-operator name, and no reason, for a company driver", () => {
    const r = fill({ questionnaire_answers: { applying_as: "company_driver" } });
    for (const id of OP_NAMES) expect(textAt(r, id), id).toBeUndefined();
    // ⚠ Page 31 is the owner-operator AND leased-driver agreement: the driver half stays.
    expect(textAt(r, "p31.driver_name")).toBe("Marija Ana Varmeda");
    // ⚠ The company driver's reason is the carrier's own printed `yes`; nothing is drawn over it.
    expect(textAt(r, "p22.reason.contracting")).toBeUndefined();
  });

  it("names the owner-operator and ticks the contracting reason for an owner-operator", () => {
    const r = fill({ questionnaire_answers: { applying_as: "owner_operator" } });
    for (const id of OP_NAMES) expect(textAt(r, id), id).toBe("Marija Ana Varmeda");
    expect(textAt(r, "p22.reason.contracting")).toBe("yes");
  });

  it("prints what the paper always printed when there is no answer", () => {
    const r = fill({ questionnaire_answers: {} });
    for (const id of OP_NAMES) expect(textAt(r, id), id).toBe("Marija Ana Varmeda");
    expect(textAt(r, "p22.reason.contracting")).toBeUndefined();
    // A value that is not one of the two keys is no answer, not a nearest match.
    const typed = fill({ questionnaire_answers: { applying_as: "Owner operator", position: "Owner operator" } });
    expect(textAt(typed, "p22.reason.contracting")).toBeUndefined();
  });

  /**
   * ⚠ The reading copy the applicant signs beside is drawn from the DRAFT, whose answers are under
   * `questionnaire`. A filler reading `questionnaire_answers` alone would show the applicant a page 31
   * that disagrees with the one filed.
   */
  it("reads a draft's answers exactly as a filed payload's", () => {
    const draft = fill({ questionnaire_answers: undefined, questionnaire: { applying_as: "company_driver" } });
    for (const id of OP_NAMES) expect(textAt(draft, id), id).toBeUndefined();
    const withOp = fill({ questionnaire_answers: undefined, questionnaire: { applying_as: "owner_operator" } });
    expect(textAt(withOp, "p22.reason.contracting")).toBe("yes");
  });
});
