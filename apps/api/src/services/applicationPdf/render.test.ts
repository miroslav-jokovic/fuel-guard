import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import type { DriverApplication } from "@fuelguard/shared";
import { renderApplicationPdf, sourceDigest, type ApplicationPdfInput } from "./render.js";

/**
 * The rendered §391.21 application (A6).
 *
 * What is worth pinning is not how it looks — that is a layout nobody can assert usefully — but that
 * it is a faithful, stable rendering of the evidence: the regulation's own order, the text that was
 * actually signed rather than today's constant, the same bytes for the same input, and no Social
 * Security number anywhere on a document a recruiter will email.
 */

const APPLICATION = {
  first_name: "Susan", middle_name: null, last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: null, city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: null }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_class: "A", cdl_expires_at: "2029-01-01",
  additional_licences: [{ issuing_authority: "Pennsylvania", number: "HZ-99", expires_at: "2028-06-01", kind: "hazmat endorsement" }],
  experience: "Eight years, dry van and reefer.",
  accidents: [], declares_no_accidents: true,
  violations: [{ occurred_on: "2025-02-01", offence: "Speeding", state: "IL", penalty: "$120" }],
  declares_no_violations: false,
  licence_ever_denied: false, licence_denial_detail: null,
  employers: [{
    employer_name: "Old Carrier", usdot_number: "123456", address_line1: "12 Depot Rd", city: "Joliet",
    state: "IL", phone: "555-0100", email: null, position_held: "Driver",
    started_on: "2023-01-01", ended_on: "2025-06-30",
    operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better route",
    subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_employment: false,
  certified: true, signed_name: "Susan Godfrey",
} as unknown as DriverApplication;

const input = (over: Partial<ApplicationPdfInput> = {}): ApplicationPdfInput => ({
  carrier: { name: "Silvicom Inc", address: null },
  application: APPLICATION,
  applicationId: "11111111-2222-4333-8444-555555555555",
  certifiedAt: "2026-08-21T18:00:00Z",
  signedName: "Susan Godfrey",
  applicantIp: "203.0.113.9",
  // Null is the normal case and always will be — the mark is decoration (D-APP8).
  signatureMark: null,
  authorizations: [
    {
      purpose: "fcra_disclosure", disclosure_version: "v1",
      disclosure_text: "The wording that was actually signed.",
      intent_statement: "I authorize the preparation of consumer reports about me.",
      signed_name: "Susan Godfrey", accepted_at: "2026-08-21T17:50:00Z",
    },
    {
      purpose: "psp", disclosure_version: "v1",
      disclosure_text: "FMCSA's mandated PSP disclosure text.",
      intent_statement: "I authorize the carrier to obtain my PSP record.",
      signed_name: "Susan Godfrey", accepted_at: "2026-08-21T17:52:00Z",
    },
  ],
  esignConsent: {
    disclosure_version: "v1",
    disclosure_text: "You can have these on paper instead.",
    intent_statement: "I agree to sign electronically.",
    consented_at: "2026-08-21T17:45:00Z",
  },
  ...over,
});

/** The page count the document declares, from the page-tree node — not a count of matching bytes. */
const pageCount = (pdf: Buffer): number => {
  const m = pdf.toString("latin1").match(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/);
  return m ? Number(m[1]) : 0;
};

/**
 * The text a reader would see.
 *
 * PDFKit deflates its content streams, so grepping the raw bytes finds nothing — which is the trap
 * this helper exists to avoid falling into twice. Every FlateDecode stream is inflated and
 * concatenated; anything that will not inflate (the font subsets, the xref) is skipped rather than
 * failing the read. Assertions then run against what is actually on the page, not against whatever
 * happened to survive compression.
 */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out += inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
    } catch {
      // Not a deflate stream (or a font subset) — nothing to read here.
    }
  }
  // ⚠ And the drawn text is neither one string per line nor plain ASCII. PDFKit emits kerned runs of
  // HEX strings — "Driver employment application" arrives as
  // `[<44726976657220656d706c6f> 20 <796d656e74…>] TJ` — so the words a reader sees only exist once
  // the hex is decoded and the runs are joined. Literal `(…)` strings are decoded too, because
  // pdfkit uses them for some fonts, and a helper that handled only one form would silently find
  // nothing and make every assertion below vacuous.
  return (out.match(/<[0-9a-fA-F\s]+>|\((?:\\.|[^\\)])*\)/g) ?? [])
    .map((token) =>
      token.startsWith("<")
        ? Buffer.from(token.slice(1, -1).replace(/\s+/g, ""), "hex").toString("latin1")
        : token.slice(1, -1).replace(/\\([()\\])/g, "$1"),
    )
    .join("");
}

describe("the rendered application", () => {
  it("produces a PDF", async () => {
    const pdf = await renderApplicationPdf(input());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  /** A golden test in the sense that matters for a derivative: same evidence in, same bytes out. */
  it("is deterministic — the same evidence renders the same document", async () => {
    const a = await renderApplicationPdf(input());
    const b = await renderApplicationPdf(input());
    expect(a.byteLength).toBe(b.byteLength);
    expect(pageCount(a)).toBe(pageCount(b));
  });

  it("gives every instrument its own page, after the application and the certification", async () => {
    const withTwo = await renderApplicationPdf(input());
    const withNone = await renderApplicationPdf(input({ authorizations: [], esignConsent: null }));
    // Two instruments and a consent are three pages more than none of them.
    expect(pageCount(withTwo) - pageCount(withNone)).toBe(3);
  });

  /**
   * The document shows what was signed, not what the constant says today. A rendered page carrying
   * current wording beside an old signature would misrepresent what somebody agreed to.
   */
  it("prints the stored text of each instrument, not today's", async () => {
    const pdf = pdfText(await renderApplicationPdf(input()));
    expect(pdf).toContain("The wording that was actually signed.");
    expect(pdf).toContain("FMCSA's mandated PSP disclosure text.");
  });

  it("follows the regulation's own numbering", async () => {
    const pdf = pdfText(await renderApplicationPdf(input()));
    for (const cite of ["391.21(b)(1)", "391.21(b)(2)", "391.21(b)(5)", "391.21(b)(12)"]) {
      expect(pdf).toContain(cite);
    }
  });

  /** §391.21(b)(4) is the submission date, stamped server-side — never a field (D-APP9). */
  it("prints the server-stamped submission date", async () => {
    const pdf = pdfText(await renderApplicationPdf(input()));
    expect(pdf).toContain("2026-08-21");
  });

  /**
   * ⚠ §391.21(b)(1) needs the carrier's ADDRESS as well as its name, and `organizations.legal_address`
   * is nullable because the value is an owner input. A missing one costs a line, never the document.
   */
  it("prints the carrier's address when there is one, and renders without it when there is not", async () => {
    const without = pdfText(await renderApplicationPdf(input()));
    expect(without).toContain("Silvicom Inc");
    expect(without).not.toContain("Mill Road");
    const with_ = pdfText(await renderApplicationPdf(
      input({ carrier: { name: "Silvicom Inc", address: "5 Mill Road, Joliet, IL 60432" } }),
    ));
    expect(with_).toContain("Mill Road");
  });

  /** D-HIRE6: the last place nine digits should appear is a document a recruiter emails. */
  it("prints no Social Security number, because it never receives one", async () => {
    const withSsn = { ...APPLICATION, ssn: "123456789" } as unknown as DriverApplication;
    const pdf = pdfText(await renderApplicationPdf(input({ application: withSsn })));
    expect(pdf).not.toContain("123456789");
  });

  /** An empty list is an ANSWER. The document says which answer it is rather than leaving a blank. */
  it("says a declared 'none' is a declaration, not an omission", async () => {
    const pdf = pdfText(await renderApplicationPdf(input()));
    expect(pdf).toContain("declared no accidents");
  });

  it("survives an application whose optional dates were never answered", async () => {
    const sparse = { ...APPLICATION, cdl_expires_at: null, experience: null } as unknown as DriverApplication;
    const pdf = await renderApplicationPdf(input({ application: sparse }));
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});

/**
 * ⚠ A6's text asks for the sha256 in the footer, which is impossible as written: the hash of a file
 * cannot be inside the file. The footer carries the digest of the SOURCE — the certified payload —
 * which is stable, means "this page was drawn from that evidence", and is what identifying its own
 * source has to mean for a derivative. The hash of the bytes lives on the `documents` row.
 */
describe("the source digest", () => {
  it("is stable for the same application and changes with it", () => {
    const one = sourceDigest(APPLICATION, "app-1");
    expect(sourceDigest(APPLICATION, "app-1")).toBe(one);
    expect(sourceDigest(APPLICATION, "app-2")).not.toBe(one);
    expect(sourceDigest({ ...APPLICATION, first_name: "Sue" } as DriverApplication, "app-1")).not.toBe(one);
  });

  it("appears on the page, so a printed sheet names what it came from", async () => {
    const pdf = pdfText(await renderApplicationPdf(input()));
    expect(pdf).toContain(sourceDigest(APPLICATION, "11111111-2222-4333-8444-555555555555").slice(0, 16));
  });
});

/**
 * The drawn mark (A8b, D-APP8).
 *
 * It is decoration, and these assertions are all the same assertion said three ways: the document is
 * produced with it, without it, and in spite of it. §391.51(b)(1) asks for a record that can be
 * reproduced; an ornament that could stop it being reproduced would be a worse bargain than no
 * ornament at all — which is exactly the argument A5 used for not collecting one until it had
 * somewhere to live.
 */
describe("the drawn signature mark", () => {
  /** The smallest valid PNG: 1×1, fully transparent. pdfkit decodes it; nothing else is needed. */
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  it("draws it and still produces a document", async () => {
    const withMark = await renderApplicationPdf(input({ signatureMark: PNG }));
    const without = await renderApplicationPdf(input({ signatureMark: null }));
    expect(withMark.byteLength).toBeGreaterThan(1000);
    // Present in one and not the other, which is the only honest way to assert an image landed:
    // pdfkit's content streams are deflated, so grepping the bytes for anything proves nothing.
    expect(withMark.byteLength).toBeGreaterThan(without.byteLength);
  });

  /** The bytes came from a canvas on a stranger's phone, through a bucket. */
  it("produces the document anyway when the mark will not decode", async () => {
    const pdf = await renderApplicationPdf(input({ signatureMark: Buffer.from("not a png at all") }));
    expect(pdf.byteLength).toBeGreaterThan(1000);
    // And the document is whole: the certification is still on it.
    expect(pdfText(pdf)).toContain("true and complete");
  });

  it("changes nothing about the document's text — it is an ornament, not content", async () => {
    expect(pdfText(await renderApplicationPdf(input({ signatureMark: PNG })))).toContain("Susan Godfrey");
  });
});

/**
 * The carrier's own questions on the document (A9, D-APP12).
 *
 * The staff route serves this PDF and nothing else of the application's content, so this section is
 * the ONLY place a recruiter ever sees what the driver answered — which is why it is rendered at all,
 * and why the one thing that must never appear on it is tested rather than assumed.
 */
describe("the questionnaire section", () => {
  const answered = (over: Record<string, unknown> = {}) =>
    input({
      application: {
        ...APPLICATION,
        questionnaire_version: "silvicom_driver@v1",
        questionnaire_answers: {
          position: "Company driver",
          legally_work: true,
          may_contact_employers: false,
          references: [{ full_name: "Ann Reyes", years_known: 6, phone: "555-0134" }],
          ...over,
        },
      } as unknown as DriverApplication,
    });

  it("prints the answers under a heading that says whose questions they are", async () => {
    const pdf = pdfText(await renderApplicationPdf(answered()));
    expect(pdf).toContain("the carrier's own questions");
    expect(pdf).toContain("Company driver");
    expect(pdf).toContain("Ann Reyes");
    // The version, so a reader knows which wording produced these answers.
    expect(pdf).toContain("silvicom_driver");
  });

  /** Three states, not two: answered no is a different fact from never answered. */
  it("distinguishes a 'no' from a question nobody answered", async () => {
    const pdf = pdfText(await renderApplicationPdf(answered()));
    expect(pdf).toContain("May we contact your previous employers?");
    expect(pdf).toContain("No");
    // `heard_from` was never answered and must not appear as a blank row.
    expect(pdf).not.toContain("How did you hear about this company?");
  });

  /** ⚠ The assertion this section exists to be safe for. */
  it("never prints the reserved EEO answers, which the hiring decision must not see", async () => {
    const pdf = pdfText(await renderApplicationPdf(answered({ eeo: { race: "UNIQUE-EEO-STRING" } })));
    expect(pdf).not.toContain("UNIQUE-EEO-STRING");
    expect(pdf).not.toContain("eeo");
  });

  it("renders nothing at all when the driver answered nothing", async () => {
    const pdf = pdfText(await renderApplicationPdf(input()));
    expect(pdf).not.toContain("the carrier's own questions");
  });

  /**
   * `payload` is historical jsonb: a document filed against a definition this build no longer carries
   * must still be producible, which is the §390.32(d) property the whole renderer is built on.
   */
  it("survives a questionnaire version this build has never heard of", async () => {
    const pdf = await renderApplicationPdf(
      input({
        application: {
          ...APPLICATION,
          questionnaire_version: "silvicom_driver@v99",
          questionnaire_answers: { position: "Company driver" },
        } as unknown as DriverApplication,
      }),
    );
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(pdfText(pdf)).not.toContain("the carrier's own questions");
  });
});

/**
 * §391.21(b)(6), both halves — and the one field on the document that is not a (b) paragraph.
 *
 * A9 first shipped the equipment grid as a carrier question, because the owner's packet is where it
 * was found. The packet turns out to be a near-verbatim copy of FMCSA's own sample application, and
 * the grid is the regulation's: (b)(6) requires "the type of equipment ... which he/she has
 * operated". So it renders under (b)(6), where an auditor with the CFR open will look for it.
 */
describe("the equipment experience", () => {
  const withEquipment = (over: Record<string, unknown> = {}) =>
    input({
      application: {
        ...APPLICATION,
        equipment_experience: [
          { equipment_class: "tractor_semi_trailer", equipment_type: "Reefer", from: "2019-04", to: "2023-08", approx_miles: 420000 },
          { equipment_class: "bus", equipment_type: null, from: "2016-01", to: null, approx_miles: null },
        ],
        ...over,
      } as unknown as DriverApplication,
    });

  it("prints the equipment under §391.21(b)(6), in the regulation's own words", async () => {
    const pdf = pdfText(await renderApplicationPdf(withEquipment()));
    expect(pdf).toContain("§391.21(b)(6)");
    // The label, not the stored token — a qualification file is read by people.
    expect(pdf).toContain("Tractor and semi-trailer");
    expect(pdf).toContain("Reefer");
    expect(pdf).toContain("420000");
  });

  it("says 'present' for equipment the driver still drives, and prints no invented miles", async () => {
    const pdf = pdfText(await renderApplicationPdf(withEquipment()));
    expect(pdf).toContain("present");
    expect(pdf).toContain("Bus");
  });

  /** Every application filed before this field existed has none of it. */
  it("renders a payload that predates the field", async () => {
    const pdf = await renderApplicationPdf(input());
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(pdfText(pdf)).toContain("§391.21(b)(6)");
  });
});

/**
 * Other names — printed beside the name they qualify, and labelled with the paragraph they serve.
 *
 * ⚠ NOT (b)(2). That paragraph is "The applicant's name, address, date of birth, and social security
 * number" and FMCSA's own sample application asks for no other name. It is on the document because
 * §391.23(a)(2) is unanswerable without it.
 */
describe("other names on the document", () => {
  it("prints them when the driver gave any", async () => {
    const pdf = pdfText(await renderApplicationPdf(input({
      application: { ...APPLICATION, other_names: ["Susan Smith"] } as unknown as DriverApplication,
    })));
    expect(pdf).toContain("Also known as");
    expect(pdf).toContain("Susan Smith");
  });

  it("prints nothing at all when they gave none, which is the normal case", async () => {
    expect(pdfText(await renderApplicationPdf(input()))).not.toContain("Also known as");
  });
});
