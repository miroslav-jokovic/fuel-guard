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
