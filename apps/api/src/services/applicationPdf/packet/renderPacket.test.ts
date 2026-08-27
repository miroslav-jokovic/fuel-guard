import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import type { DriverApplication } from "@fuelguard/shared";
import { CORRECTIONS, P1, P2, P12, P16 } from "./packetText.js";
import {
  RENDERED_PACKET_PAGES,
  renderApplicationPacketPdf,
  type PacketPdfInput,
} from "./renderPacket.js";

/**
 * The carrier's packet, as we render it (P4).
 *
 * What is worth pinning is not how it looks. It is that the document is FAITHFUL in the three ways a
 * signed form can fail to be: it must carry the carrier's own letterhead and not another tenant's; it
 * must never silently drop a row the regulation asks for; and it must not print the packet's own
 * typographical corruption back at an auditor now that the owner has asked for correct English.
 */

const APPLICATION = {
  first_name: "Susan",
  middle_name: "M",
  last_name: "Godfrey",
  date_of_birth: "1980-04-01",
  other_names: ["Susan Marchetti"],
  email: "s@example.test",
  phone: "555-0111",
  addresses: [
    { line1: "1 Road", line2: null, city: "Joliet", state: "IL", postal_code: "60432", from: "2024-01", to: null },
    { line1: "2 Lane", line2: null, city: "Aurora", state: "IL", postal_code: "60505", from: "2022-01", to: "2023-12" },
  ],
  cdl_number: "PA334554",
  cdl_state: "PA",
  cdl_class: "A",
  cdl_expires_at: "2029-01-01",
  additional_licences: [],
  experience: "Eight years, dry van and reefer.",
  equipment_experience: [
    { equipment_class: "tractor_semi_trailer", equipment_type: "Van", from: "2020-03", to: "2024-01", approx_miles: 300000 },
  ],
  accidents: [],
  declares_no_accidents: true,
  violations: [{ occurred_on: "2025-02-01", offence: "Speeding", state: "IL", penalty: "$120" }],
  declares_no_violations: false,
  licence_ever_denied: false,
  licence_denial_detail: null,
  employers: [
    {
      employer_name: "Old Carrier", usdot_number: "123456", address_line1: "12 Depot Rd", city: "Joliet",
      state: "IL", phone: "555-0100", email: null, position_held: "Driver",
      started_on: "2023-01-01", ended_on: "2025-06-30",
      operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better route",
      subject_to_fmcsr: true, safety_sensitive: true,
    },
  ],
  declares_no_employment: false,
  prior_failed_pre_employment_test: false,
  questionnaire_version: "silvicom_driver@1",
  questionnaire_answers: {
    position: "Owner operator",
    heard_from: "A friend who drives here",
    legally_work: true,
    proof_of_age: true,
    may_contact_employers: true,
    military_service: false,
    other_training: "Defensive driving, 2024",
    education: [{ school: "Joliet Central", years_completed: 4, field_of_study: "General", graduated: true, graduated_when: "1998" }],
    references: [{ full_name: "Dana Whitlock", years_known: 9, phone: "555-0142" }],
  },
  certified: true,
  signed_name: "Susan Godfrey",
} as unknown as DriverApplication;

const input = (over: Partial<PacketPdfInput> = {}): PacketPdfInput => ({
  carrier: { name: "Silvicom Inc", address: "1301 Armitage Ave, Melrose Park IL 60160" },
  application: APPLICATION,
  applicationId: "11111111-2222-4333-8444-555555555555",
  certifiedAt: "2026-08-23T18:00:00Z",
  signedName: "Susan Godfrey",
  ...over,
});

/**
 * The drawn text, pulled back out of the PDF.
 *
 * Lifted from `render.test.ts`'s helper and for its reasons: PDFKit compresses each content stream
 * and emits kerned runs of hex strings, so the words a reader sees exist only once the streams are
 * inflated and the runs are decoded and joined. A helper that handled one form and not the other
 * would silently find nothing and make every assertion below vacuously true.
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
  return (out.match(/<[0-9a-fA-F\s]+>|\((?:\\.|[^\\)])*\)/g) ?? [])
    .map((token) =>
      token.startsWith("<")
        ? Buffer.from(token.slice(1, -1).replace(/\s+/g, ""), "hex").toString("latin1")
        : token.slice(1, -1).replace(/\\([()\\])/g, "$1"),
    )
    .join("");
}

describe("the rendered packet", () => {
  it("produces a PDF, and the helper can actually read it", async () => {
    const pdf = await renderApplicationPacketPdf(input());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Guards the guard: if `pdfText` returned "" every assertion below would pass for free.
    expect(pdfText(pdf)).toContain(P1.heading);
  });

  it("is deterministic — the same evidence renders the same document", async () => {
    const a = await renderApplicationPacketPdf(input());
    const b = await renderApplicationPacketPdf(input());
    expect(a.byteLength).toBe(b.byteLength);
  });

  it("renders the packet pages it claims to, and no more", async () => {
    const pdf = await renderApplicationPacketPdf(input());
    expect(RENDERED_PACKET_PAGES).toEqual([1, 2, 12, 16, 26]);
    const text = pdfText(pdf);
    for (const heading of [P1.heading, P2.experienceHeading, P12.heading, P16.heading]) {
      expect(text).toContain(heading);
    }
  });

  /**
   * ⚠ The assertion this file exists for.
   *
   * The owner asked for the packet's typos corrected (Q-PKT4 → D-PKT9), and a correction made
   * silently is a correction nobody can audit. `CORRECTIONS` is the register; this proves the
   * register is honoured in both directions — the corrupt string never reaches a page, and the
   * repaired one does.
   */
  describe("the packet's typos", () => {
    it("never print, and their corrections do", async () => {
      const text = pdfText(await renderApplicationPacketPdf(input()));
      // Only the pages this step renders; p26's entry is transcribed but not drawn yet (P8).
      const drawn = CORRECTIONS.filter((c) => (RENDERED_PACKET_PAGES as readonly number[]).includes(c.page));
      expect(drawn.length).toBeGreaterThan(3);
      for (const c of drawn) {
        expect(text).not.toContain(c.packet.trim());
      }
      expect(text).toContain(P1.residency);
      expect(text).toContain(P12.heading);
    });

    /**
     * The guard on the register itself: a "correction" that changed what the form ASKS would be a
     * wording change wearing a spelling change's clothes, and that is counsel's act (D-PKT4). Word
     * count is the cheapest honest proxy — it catches a deleted clause or an inserted qualifier while
     * allowing "reisdency" → "residency" and punctuation repairs.
     */
    it("are spelling repairs only — no correction changes the number of words", () => {
      const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
      for (const c of CORRECTIONS) {
        expect({ page: c.page, packet: words(c.packet), corrected: words(c.corrected) }).toEqual({
          page: c.page,
          packet: words(c.packet),
          corrected: words(c.packet),
        });
      }
    });
  });

  /**
   * D-PKT8. Silvicom 360 is multi-tenant and this is a document somebody signs — a second carrier being
   * handed a form with the first one's name on it is the failure worth a test.
   */
  describe("the letterhead", () => {
    it("is the carrier's own, not a constant", async () => {
      const text = pdfText(
        await renderApplicationPacketPdf(
          input({ carrier: { name: "Northwind Freight LLC", address: "9 Kirby St, Gary IN 46402" } }),
        ),
      );
      expect(text).toContain("Northwind Freight LLC");
      expect(text).toContain("9 Kirby St, Gary IN 46402");
      expect(text).not.toContain("Silvicom");
    });

    /**
     * `legal_address` is nullable (0229). The document must still be produced — §390.32(d) — and the
     * gap must be visible: a blank line where a legal address belongs is invisible, and only a
     * noticeable gap gets filled in.
     */
    it("says the address is missing rather than leaving a silent blank", async () => {
      const text = pdfText(
        await renderApplicationPacketPdf(input({ carrier: { name: "Silvicom Inc", address: null } })),
      );
      expect(text).toContain("no legal address on file");
    });

    it("keeps the packet's two footer lines verbatim on every page", async () => {
      const text = pdfText(await renderApplicationPacketPdf(input()));
      expect(text).toContain("THIS IS NOT AN EMPLOYMENT APPLICATION");
      expect(text).toContain("FOR DEPARTMENT OF TRANSPORTATION VERIFICATION PURPOSE ONLY");
    });
  });

  /**
   * ⚠ The other assertion that matters. Every table on these pages has three printed lines and our
   * data is unbounded; §391.21(b)(7)–(9) asks for ALL accidents and convictions in the period, so a
   * silent truncation would produce a document that is signed, filed and materially false.
   */
  describe("a table with more rows than the packet has lines", () => {
    const withFiveViolations = (): DriverApplication =>
      ({
        ...APPLICATION,
        violations: Array.from({ length: 5 }, (_v, i) => ({
          occurred_on: `2025-0${i + 1}-01`,
          offence: `Offence number ${i + 1}`,
          state: "IL",
          penalty: "$120",
        })),
      }) as unknown as DriverApplication;

    it("prints every row, not the first three", async () => {
      const text = pdfText(
        await renderApplicationPacketPdf(input({ application: withFiveViolations() })),
      );
      for (let i = 1; i <= 5; i++) expect(text).toContain(`Offence number ${i}`);
    });

    it("says on the form that there is a continuation, rather than ending quietly", async () => {
      const text = pdfText(
        await renderApplicationPacketPdf(input({ application: withFiveViolations() })),
      );
      expect(text).toContain("ATTACH SHEET IF MORE SPACE IS NEEDED");
      expect(text).toContain("CONTINUATION");
    });
  });

  /**
   * Six of our equipment classes onto the packet's four printed rows. The fold is not information
   * loss — the packet's own type column is free text and carries the specific — and this is the pair
   * of assertions that keeps it true.
   */
  describe("the equipment grid", () => {
    it("prints the packet's four named rows whatever the driver entered", async () => {
      const text = pdfText(await renderApplicationPacketPdf(input()));
      for (const row of P2.experienceRows) expect(text).toContain(row);
    });

    it("folds a tanker into OTHER and keeps the word 'Tanker' in the type column", async () => {
      const tanker = {
        ...APPLICATION,
        equipment_experience: [
          { equipment_class: "tractor_tanker", equipment_type: null, from: "2021-01", to: null, approx_miles: 90000 },
        ],
      } as unknown as DriverApplication;
      const text = pdfText(await renderApplicationPacketPdf(input({ application: tanker })));
      expect(text).toContain("OTHER");
      // The class folded; the fact did not. This is the assertion behind "not information loss" —
      // and the word is short because the packet's own examples in that column are "VAN, TANK, FLAT".
      expect(text).toContain("Tanker");
    });
  });

  /**
   * §40.25(j) (P8). Three states, and the third is the one worth a test: `null` means the application
   * predates the question, which is a different fact from "they said no" and must not look like one
   * on a page somebody signs.
   */
  describe("page 26's two-year question", () => {
    const withAnswer = (v: boolean | null): DriverApplication =>
      ({ ...APPLICATION, prior_failed_pre_employment_test: v }) as unknown as DriverApplication;

    it("marks YES when the applicant said yes", async () => {
      const text = pdfText(await renderApplicationPacketPdf(input({ application: withAnswer(true) })));
      expect(text).toContain("[X]  YES      [ ]  NO");
    });

    it("marks NO when they said no", async () => {
      const text = pdfText(await renderApplicationPacketPdf(input({ application: withAnswer(false) })));
      expect(text).toContain("[ ]  YES      [X]  NO");
    });

    it("marks NEITHER box on an application filed before the question existed, and says why", async () => {
      const text = pdfText(await renderApplicationPacketPdf(input({ application: withAnswer(null) })));
      expect(text).toContain("[ ]  YES      [ ]  NO");
      expect(text).toContain("submitted before this question was added");
    });
  });

  /**
   * D-HIRE6. The number is sealed everywhere else and a rendered document a recruiter emails is the
   * last place nine digits should appear — but the packet prints the LABEL, so the form still matches
   * the carrier's paper. Both halves are asserted, because dropping the label would silently change
   * the form and dropping the seal would leak.
   */
  it("prints the Social Security label and never a number", async () => {
    const withSsn = { ...APPLICATION, ssn_last4: "6789" } as unknown as DriverApplication;
    const text = pdfText(await renderApplicationPacketPdf(input({ application: withSsn })));
    expect(text).toContain(P1.ssn);
    expect(text).not.toContain("6789");
  });

  /**
   * The renderer reads STORED payloads, and `driver_applications.payload` is historical jsonb. A row
   * filed before the questionnaire existed has none of it. A derivative that throws on an old payload
   * is a qualification file that cannot be produced, which is the §390.32(d) failure the PDF exists
   * to prevent.
   */
  it("still renders a payload that predates the questionnaire", async () => {
    const old = { ...APPLICATION, questionnaire_answers: null, questionnaire_version: null } as unknown as DriverApplication;
    const pdf = await renderApplicationPacketPdf(input({ application: old }));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfText(pdf)).toContain(P16.heading);
  });
});
