import { describe, it, expect } from "vitest";
import type { DriverApplication } from "@silvicom/shared";
import { AUTHORIZATION_PURPOSES } from "@silvicom/shared";
import { pdfDrawnLines, pdfDrawnRules, pdfPageTexts, pdfText } from "../../../testing/pdfText.js";
import { purposeLabel } from "./certificate.js";
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
  applicantUserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  // Null is the normal case and always will be — the mark is decoration (D-APP8).
  signatureMark: null,
  // The FILED document. `preview: { stage }` is the other document this renderer draws (F6).
  preview: null,
  authorizations: [
    {
      purpose: "fcra_disclosure", disclosure_version: "v1",
      disclosure_text: "The wording that was actually signed.",
      intent_statement: "I authorize the preparation of consumer reports about me.",
      signed_name: "Susan Godfrey", accepted_at: "2026-08-21T17:50:00Z",
      method: "esign", accepted_ip: "203.0.113.9",
      accepted_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    },
    {
      purpose: "psp", disclosure_version: "v1",
      disclosure_text: "FMCSA's mandated PSP disclosure text.",
      intent_statement: "I authorize the carrier to obtain my PSP record.",
      signed_name: "Susan Godfrey", accepted_at: "2026-08-21T17:52:00Z",
      method: "esign", accepted_ip: "203.0.113.9",
      accepted_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    },
  ],
  esignConsent: {
    disclosure_version: "v1",
    disclosure_text: "You can have these on paper instead.",
    intent_statement: "I agree to sign electronically.",
    consented_at: "2026-08-21T17:45:00Z",
    applicant_ip: "203.0.113.9",
    applicant_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  },
  ...over,
});

/** The page count the document declares, from the page-tree node — not a count of matching bytes. */
const pageCount = (pdf: Buffer): number => {
  const m = pdf.toString("latin1").match(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/);
  return m ? Number(m[1]) : 0;
};

/**
 * The drawn text — through `testing/pdfText.ts`, the shared reader. This file carried its own copy
 * until Q-AF2 (2026-09-25); it decoded every hex string one byte per character, and read the
 * embedded face's glyph ids as mojibake. One reader, which honours `ToUnicode`.
 */

describe("the rendered application", () => {
  it("produces a PDF", async () => {
    const pdf = await renderApplicationPdf(input());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  /**
   * ⚠ The FILED document's own lede, which `pdfDraw.test.ts` cannot reach (AUD-8, 2026-09-20).
   *
   * The first line a reader sees says which of the two documents this is, and it was set with the
   * same `muted()` that put `Version v0-draft` in the certificate's label column — so the rule under
   * it sat 7.65pt away and read as an underline on the lede rather than as the boundary between the
   * masthead and §391.21(b)(1). Nothing about the words changes either way, which is why this is a
   * measurement and not a `toContain`.
   */
  it("sets its lede as a caption on the title, not as a line of the block below", async () => {
    const pdf = await renderApplicationPdf(input());
    const lines = await pdfDrawnLines(pdf);
    const ledeEnd = lines.findIndex((l) => l.text.includes("Completed and certified by the applicant"));
    expect(ledeEnd).toBeGreaterThan(0);
    const separator = (await pdfDrawnRules(pdf)).find((r) => r.page === lines[ledeEnd]!.page);
    expect(separator).toBeDefined();
    // Clear of the lede by more than the lede's own leading — measured against the step pdfkit set
    // between the title and it, so the claim does not depend on a constant written in this file.
    expect(separator!.y - lines[ledeEnd]!.y)
      .toBeGreaterThan(lines[ledeEnd]!.y - lines[ledeEnd - 1]!.y);
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
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    expect(pdf).toContain("The wording that was actually signed.");
    expect(pdf).toContain("FMCSA's mandated PSP disclosure text.");
  });

  it("follows the regulation's own numbering", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    for (const cite of ["391.21(b)(1)", "391.21(b)(2)", "391.21(b)(5)", "391.21(b)(12)"]) {
      expect(pdf).toContain(cite);
    }
  });

  /** §391.21(b)(4) is the submission date, stamped server-side — never a field (D-APP9). */
  it("prints the server-stamped submission date", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    expect(pdf).toContain("2026-08-21");
  });

  /**
   * ⚠ §391.21(b)(1) needs the carrier's ADDRESS as well as its name, and `organizations.legal_address`
   * is nullable because the value is an owner input. A missing one costs a line, never the document.
   */
  it("prints the carrier's address when there is one, and renders without it when there is not", async () => {
    const without = (await pdfText(await renderApplicationPdf(input())));
    expect(without).toContain("Silvicom Inc");
    expect(without).not.toContain("Mill Road");
    const with_ = (await pdfText(await renderApplicationPdf(
      input({ carrier: { name: "Silvicom Inc", address: "5 Mill Road, Joliet, IL 60432" } }),
    )));
    expect(with_).toContain("Mill Road");
  });

  /** D-HIRE6: the last place nine digits should appear is a document a recruiter emails. */
  it("prints no Social Security number, because it never receives one", async () => {
    const withSsn = { ...APPLICATION, ssn: "123456789" } as unknown as DriverApplication;
    const pdf = (await pdfText(await renderApplicationPdf(input({ application: withSsn }))));
    expect(pdf).not.toContain("123456789");
  });

  /** An empty list is an ANSWER. The document says which answer it is rather than leaving a blank. */
  it("says a declared 'none' is a declaration, not an omission", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    expect(pdf).toContain("declared no accidents");
  });

  /**
   * ── EVERY PARAGRAPH SAYS SOMETHING, INCLUDING THE ONES WITH NOTHING IN THEM (AUD-11) ────────
   *
   * ⚠ **This is the general form of the defect, and it is worth a test of its own because the
   * specific ones below cannot see the next section somebody adds.** (b)(3) printed a heading and
   * then the next heading: a reader of a §391.21 form cannot tell that from a paragraph the
   * document never asked about, and on a filed qualification record those are very different
   * things. Written against the DRAWN RUNS in order, so it reads the document the way a reader
   * does — the citation, and then whatever is actually under it.
   *
   * ⚠ It does not catch (b)(6)'s own silence, which was a lone em dash — a run, and therefore not a
   * heading. A dash IS drawn, so only a test that knows what the dash means can fail on it; that is
   * the next test, and this comment is here so the pair is not mistaken for a duplicate.
   */
  it("never draws a §391.21 heading with the next heading directly under it", async () => {
    const lines = await pdfDrawnLines(await renderApplicationPdf(input({
      application: {
        ...APPLICATION, addresses: [], experience: null, equipment_experience: [],
        accidents: [], violations: [], employers: [],
      } as unknown as DriverApplication,
    })));
    const isCitation = (t: string): boolean => t.startsWith("§391.21(b)(");
    const cited = lines.filter((l) => isCitation(l.text));
    // The guard on the guard: a walk that found no citations would pass every assertion below.
    expect(cited.length, "the regulation's own paragraphs are on the page").toBeGreaterThanOrEqual(9);

    for (const heading of cited) {
      const next = lines[lines.indexOf(heading) + 1];
      expect(next, `${heading.text} is not the last thing on the document`).toBeDefined();
      expect(isCitation(next!.text), `${heading.text} has an answer under it, not another heading`)
        .toBe(false);
    }
  });

  /**
   * (b)(6) asks for two things in one sentence, so a silence there needs to say WHICH half (AUD-11).
   *
   * ⚠ **The lone em dash this replaces was the purest form of the defect in this document**: it is
   * drawn, so the structural test above passes on it; it sits where a value goes, so it reads as an
   * answer; and it says nothing about which of the paragraph's two halves is missing. The test that
   * covered this line before asserted `pdf.byteLength > 1000` and was green throughout.
   *
   * ⚠ Each case is SLICED to the (b)(6) block. `Not answered.` is the right sentence in three other
   * paragraphs of this document, so an unscoped `toContain` would be green on a document where
   * (b)(6) still printed a dash — the exact shape of vacuous assertion this file keeps failing to.
   */
  it("names which half of (b)(6) is missing, and says nothing about the half that is not", async () => {
    const equipment = [{ equipment_class: "tractor_semi_trailer", equipment_type: "Van", from: "2020-01", to: null, approx_miles: "250000" }];
    const block = async (over: Record<string, unknown>): Promise<string> => {
      const text = (await pdfText(await renderApplicationPdf(input({
        application: { ...APPLICATION, ...over } as unknown as DriverApplication,
      }))));
      return text.slice(text.indexOf("§391.21(b)(6)"), text.indexOf("§391.21(b)(7)"));
    };

    // The narrative given, the equipment never listed.
    const noEquipment = await block({ equipment_experience: [] });
    expect(noEquipment).toContain("Eight years, dry van and reefer.");
    expect(noEquipment).toContain("The type of equipment operated was not answered.");
    expect(noEquipment).not.toContain("nature and extent");

    // The equipment listed, the narrative never given.
    const noNarrative = await block({ experience: null, equipment_experience: equipment });
    expect(noNarrative).toContain("The nature and extent of the experience was not answered.");
    expect(noNarrative).toContain("Tractor and semi-trailer");
    expect(noNarrative).not.toContain("type of equipment operated");

    // ⚠ Neither half: ONE sentence, and it is the one the rest of the document uses. Two sentences
    // here would read as two separate faults rather than as a paragraph nobody answered.
    const neither = await block({ experience: null, equipment_experience: [] });
    expect(neither).toContain("Not answered.");
    expect(neither).not.toContain("nature and extent");
    expect(neither).not.toContain("type of equipment operated");
    // ...and the em dash it used to print is gone, rather than joined by a sentence.
    expect(neither).not.toMatch(/[—–-]\s*$/);
  });

  /**
   * (b)(3) has no "declared none" and should not grow one (AUD-11).
   *
   * ⚠ The sentence is `Not answered.` and not `The applicant declared no addresses.` because the
   * contract carries exactly three declaration flags — accidents, violations, employment — and an
   * address is not a thing anybody can truthfully declare none of. An empty (b)(3) is an omission
   * and can only be one, which is a fact about the regulation rather than about this renderer.
   */
  it("says an empty (b)(3) was not answered, rather than printing a bare heading", async () => {
    const text = (await pdfText(await renderApplicationPdf(input({
      application: { ...APPLICATION, addresses: [] } as unknown as DriverApplication,
    }))));
    const block = text.slice(text.indexOf("§391.21(b)(3)"), text.indexOf("§391.21(b)(4)"));
    expect(block).toContain("Not answered.");
    expect(block).not.toContain("declared no");
  });

  it("survives an application whose optional dates were never answered", async () => {
    const sparse = { ...APPLICATION, cdl_expires_at: null, experience: null } as unknown as DriverApplication;
    const pdf = await renderApplicationPdf(input({ application: sparse }));
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});

/**
 * The office's preview of an application nobody has signed (F6).
 *
 * ⚠ What is worth pinning is not the band's position but the two ways this document could LIE: by
 * looking signed when it is not, and by looking like a draft when it is the filing. Both are one
 * boolean away from each other, and a reader of the diff cannot see either.
 */
describe("the draft preview", () => {
  /** A draft as `toDraftPayload` actually writes one: no certification, empty strings for blanks. */
  const DRAFT = {
    first_name: "Susan", middle_name: "", last_name: "Godfrey", date_of_birth: "1980-04-01",
    email: "s@example.test", phone: "",
    addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
    cdl_number: "PA334554", cdl_state: "PA", cdl_class: "A", cdl_expires_at: "",
    equipment_experience: [{ equipment_class: "tractor_semi_trailer", equipment_type: "Van", from: "2020-01", to: "", approx_miles: "" }],
    employers: [], declares_no_employment: false,
    accidents: [], declares_no_accidents: false,
    violations: [], declares_no_violations: false,
    licence_ever_denied: false, licence_denial_detail: "",
    questionnaire: { proof_of_age: true },
  } as unknown as ApplicationPdfInput["application"];

  const preview = (over: Partial<ApplicationPdfInput> = {}): ApplicationPdfInput =>
    input({
      application: DRAFT,
      certifiedAt: null,
      signedName: "",
      applicantIp: null,
      preview: { stage: "filling" },
      ...over,
    });

  it("says DRAFT on every page, in words", async () => {
    const pdf = await renderApplicationPdf(preview());
    const text = (await pdfText(pdf));
    expect(text).toContain("DRAFT - NOT A SIGNED APPLICATION");
    // Once per sheet: a preview gets printed and separated, and a loose page has to carry its status.
    const band = text.split("DRAFT - NOT A SIGNED APPLICATION").length - 1;
    expect(band).toBe(pageCount(pdf));
  });

  /** The band is the whole point, so a filing that carried it would be the worse of the two bugs. */
  it("puts no band on the filed document", async () => {
    expect((await pdfText(await renderApplicationPdf(input())))).not.toContain("DRAFT");
  });

  /**
   * ⚠ The assertion is scoped to the CERTIFICATION BLOCK, and it has to be. The applicant's name is
   * all over a legitimate preview — the (b)(2) name block, the footer of every sheet, and each
   * authorization they really did sign before the form. The only place it must not appear is under
   * the §391.21(b)(12) statement, where it would read as a signature nobody has given.
   */
  it("prints no signature under the certification, and no submission date", async () => {
    const text = (await pdfText(await renderApplicationPdf(preview())));
    expect(text).toContain("Not submitted yet");
    const block = text.slice(text.indexOf("§391.21(b)(12)"), text.indexOf("NOT SIGNED."));
    expect(block).not.toContain("Susan Godfrey");
    expect(block).not.toContain("2026-08-21");
  });

  it("says where it has got to, in the office's own words", async () => {
    expect((await pdfText(await renderApplicationPdf(preview())))).toContain("filling it in");
    const waiting = await renderApplicationPdf(preview({ preview: { stage: "awaiting_review" } }));
    expect((await pdfText(waiting))).toContain("waiting for you");
  });

  /**
   * ⚠ The releases come BEFORE the form (D-AX11), so they are signed while the application is still
   * a draft — and which of them the carrier holds is half of what an office reads a draft for.
   */
  it("still shows the instruments that HAVE been signed", async () => {
    const text = (await pdfText(await renderApplicationPdf(preview())));
    expect(text).toContain("The wording that was actually signed.");
    expect(text).toContain("Certificate of completion");
    expect(text).toContain("Not signed yet.");
  });

  /**
   * ⚠ A draft holds an unanswered number as the form's own empty STRING, which is not null. The
   * null-check this line used to carry printed nothing at all beside the label.
   */
  it("renders a draft's empty answers as blanks rather than as nothing", async () => {
    const text = (await pdfText(await renderApplicationPdf(preview())));
    expect(text).toContain("Approximate miles");
    expect(text).toContain("Not answered.");
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
    const pdf = (await pdfText(await renderApplicationPdf(input())));
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
    expect((await pdfText(pdf))).toContain("true and complete");
  });

  it("changes nothing about the document's text — it is an ornament, not content", async () => {
    expect((await pdfText(await renderApplicationPdf(input({ signatureMark: PNG }))))).toContain("Susan Godfrey");
  });
});

/**
 * The carrier's own questions on the document (A9, D-APP12).
 *
 * The staff route serves this PDF and nothing else of the application's content, so this section is
 * the ONLY place a recruiter ever sees what the driver answered — which is why it is rendered at all,
 * and why the one thing that must never appear on it is tested rather than assumed.
 *
 * ── ⚠ WHY MOST OF THESE READ GEOMETRY AND NOT TEXT (AUD-22) ──────────────────────────────────
 * The finding is about a question that is ABSENT, and the fix prints a sentence beside it. Both the
 * label and the sentence are on the page in either world once anything else is unanswered, so
 * `toContain` cannot tell the fixed document from the broken one — it can only say some question
 * somewhere went unanswered. What discriminates is WHICH label the sentence was drawn beside, which
 * is a coordinate. `valueBeside` reads it out of the stream.
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

  /**
   * What the document printed in the VALUE column of the row this label opens.
   *
   * `field()` draws both halves from the same cursor — the label at the left margin, the value 134pt
   * in — and a label too long for its 130pt column wraps into further runs at the same x and a lower
   * y. So the value is the run to the RIGHT of the first run, on that run's line.
   *
   * ⚠ **"On that run's line" is a tolerance and not an equality, and the 0.36pt is measured.** The
   * label is drawn at 9pt and the value at 9.5, and pdfkit places a run's text matrix off its own
   * ascender — so the pair a reader sees as one row is `y=102.88` and `y=103.24`. Two points is
   * comfortably inside one 14pt row and cannot reach the next label, which is the only thing the
   * tolerance has to be smaller than.
   */
  const valueBeside = (lines: Awaited<ReturnType<typeof pdfDrawnLines>>, label: string): string | null => {
    // ⚠ `trimEnd`, because pdfkit KEEPS the space it broke the line on: the first run of a wrapped
    // label is `"How did you hear about this "`, and an equality on the visible words finds nothing.
    const row = lines.find((l) => l.text.trimEnd() === label);
    if (!row) return null;
    return lines.find((l) => l.page === row.page && Math.abs(l.y - row.y) < 2 && l.x > row.x)?.text ?? null;
  };

  /**
   * ⚠ Q-HM14's answer is stored as a KEY; the qualification file prints what the applicant chose.
   * Read against v2, the definition that asked it — `questionnaireByRef` is what finds the label.
   */
  it("prints what they are applying as in words, never the stored key", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(input({
      application: {
        ...APPLICATION,
        questionnaire_version: "silvicom_driver@v2",
        questionnaire_answers: { applying_as: "owner_operator" },
      } as unknown as DriverApplication,
    }))));
    expect(pdf).toContain("Owner-operator");
    expect(pdf).not.toContain("owner_operator");
  });

  it("prints the answers under a heading that says whose questions they are", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(answered())));
    expect(pdf).toContain("the carrier's own questions");
    expect(pdf).toContain("Company driver");
    expect(pdf).toContain("Ann Reyes");
    // The version, so a reader knows which wording produced these answers.
    expect(pdf).toContain("silvicom_driver");
  });

  /**
   * Three states, not two: answered no is a different fact from never answered — and BOTH are
   * different from a question that is not on the page at all, which is what this used to assert and
   * is the whole of AUD-22. A recruiter reading "May we contact your previous employers?" with
   * nothing under it cannot tell a refusal from a question the form never asked.
   */
  it("prints a 'no', a value and an unanswered question as three different things", async () => {
    const lines = await pdfDrawnLines(await renderApplicationPdf(answered()));
    expect(valueBeside(lines, "Position you are applying for")).toBe("Company driver");
    expect(valueBeside(lines, "May we contact your previous")).toBe("No");
    // ⚠ The row AUD-22 is about: asked, left blank, and now on the page saying so.
    expect(valueBeside(lines, "How did you hear about this")).toBe("Not answered.");
  });

  /**
   * ⚠ `false` and `0` are ANSWERS, and the predicate that decides this is one `||` away from eating
   * them. A questionnaire that printed "Not answered." over a driver's "No" would be worse than the
   * defect it replaced: the first misreads the document, the second only leaves a gap in it.
   */
  it("never mistakes a false or a zero for a silence", async () => {
    const lines = await pdfDrawnLines(await renderApplicationPdf(answered({
      military_service: false,
      references: [{ full_name: "Ann Reyes", years_known: 0, phone: "555-0134" }],
    })));
    expect(valueBeside(lines, "Have you ever served in the")).toBe("No");
    expect(valueBeside(lines, "Years known")).toBe("0");
  });

  /**
   * An unanswered grid is not a grid. It gets one row in the same shape as every other unanswered
   * question, and NOT its own heading over a lone sentence — so the column labels of a table nobody
   * filled in are absent, and the question itself is not.
   */
  it("prints an unanswered table as one row, with none of its column headings", async () => {
    const lines = await pdfDrawnLines(await renderApplicationPdf(answered({ references: [] })));
    expect(valueBeside(lines, "Three personal references")).toBe("Not answered.");
    expect(valueBeside(lines, "Education and training")).toBe("Not answered.");
    expect(lines.some((l) => l.text === "Full name")).toBe(false);
    expect(lines.some((l) => l.text === "School or university")).toBe(false);
  });

  /** The same rule one level down: a blank cell in a row the applicant DID fill in says so too. */
  it("says which cell of an answered row was left blank", async () => {
    const lines = await pdfDrawnLines(await renderApplicationPdf(answered({
      references: [{ full_name: "Marcus Whitfield", years_known: 12, phone: null }],
    })));
    expect(valueBeside(lines, "Full name")).toBe("Marcus Whitfield");
    expect(valueBeside(lines, "Phone number")).toBe("Not answered.");
  });

  /**
   * ⚠ The em dash is the defect wearing a costume — a drawn mark that reads as an answer and is the
   * absence of one. `blank()` was this module's own copy of the house rule and AUD-22 left it with
   * no caller; this is what stops the next edit reinstating it. The sweep is over the questionnaire
   * SHEET only: the §391.21 pages above it print dashes on purpose, for fields the applicant was
   * never asked to fill in.
   */
  it("prints no em dash anywhere on the carrier's page", async () => {
    const lines = await pdfDrawnLines(await renderApplicationPdf(answered({ heard_from: "   " })));
    const sheet = lines.find((l) => l.text.includes("the carrier's own questions"))!.page;
    expect(sheet, "the questionnaire page was found").toBeGreaterThan(0);
    // ⚠ The sheet's own HEADING is excluded by name: *"Silvicom Inc — the carrier's own questions"*
    // uses the dash as punctuation, which is not the defect. Until Q-AF2 (2026-09-25) this sweep could
    // not see an em dash AT ALL — the old reader decoded WinAnsi 0x97 as a control character — so it
    // passed whatever the page drew. It reads the real character now, which is why the exclusion is
    // needed and why the sweep finally discriminates.
    const dashes = lines.filter(
      (l) => l.page === sheet && l.text.includes("—") && !l.text.includes("the carrier's own questions"),
    );
    expect(dashes.map((d) => d.text)).toEqual([]);
    // ⚠ And the whitespace answer that used to produce one is the row that says so instead.
    expect(valueBeside(lines, "How did you hear about this")).toBe("Not answered.");
  });

  /** ⚠ The assertion this section exists to be safe for. */
  it("never prints the reserved EEO answers, which the hiring decision must not see", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(answered({ eeo: { race: "UNIQUE-EEO-STRING" } }))));
    expect(pdf).not.toContain("UNIQUE-EEO-STRING");
    expect(pdf).not.toContain("eeo");
  });

  /**
   * ⚠ A version with NO readable answer is a real filed state, not a crafted one: `draft.ts` stamps
   * the version only when something was answered, and `cleanQuestionnaire` counts the reserved `eeo`
   * key as something. The applicant who self-identified and answered nothing else was asked all ten
   * of the carrier's questions, so the document says all ten went unanswered — and says nothing
   * whatever about the key that did not.
   */
  it("prints every question as unanswered when the version is stamped and nothing readable was answered", async () => {
    const pdf = await renderApplicationPdf(input({
      application: {
        ...APPLICATION,
        questionnaire_version: "silvicom_driver@v1",
        questionnaire_answers: { eeo: { race: "UNIQUE-EEO-STRING" } },
      } as unknown as DriverApplication,
    }));
    const lines = await pdfDrawnLines(pdf);
    expect(valueBeside(lines, "Position you are applying for")).toBe("Not answered.");
    expect(valueBeside(lines, "Three personal references")).toBe("Not answered.");
    expect((await pdfText(pdf))).not.toContain("UNIQUE-EEO-STRING");
  });

  /** Nobody was asked: the version is null, so there is no question to print and no page for it. */
  it("renders nothing at all when the driver answered nothing", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    expect(pdf).not.toContain("the carrier's own questions");
  });

  /**
   * AUD-23, and the payload is the one the sweep found rather than one invented to pass.
   *
   * Five education rows, one reference and a 30-word answer to "any other training" put
   * `Three personal references` alone at the foot of its sheet, with `Full name` opening the next —
   * 27 of 1,148 payloads did, at 3d4b298 and before AUD-22 was written. `section()` measures the
   * heading against its first row now and turns the page before drawing either.
   */
  it("never leaves a grid's heading alone at the foot of a sheet", async () => {
    const lines = await pdfDrawnLines(await renderApplicationPdf(answered({
      other_training: "word ".repeat(30).trim(),
      education: Array.from({ length: 5 }, (_, i) => ({
        school: `School number ${i + 1}`, years_completed: i + 1,
        field_of_study: "Diesel technology", graduated: true, graduated_when: `20${11 + i}`,
      })),
      references: [{ full_name: "Ann Reyes", years_known: 6, phone: "555-0134" }],
    })));
    const heading = lines.find((l) => l.text === "Three personal references")!;
    expect(heading, "the grid's heading was drawn").toBeDefined();
    const after = lines.filter((l) => l.page === heading.page && l.y > heading.y);
    // ⚠ Not "something follows it" — the FOOTER always does. The first row of its own grid must.
    expect(after.map((l) => l.text)).toContain("Full name");
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
    expect((await pdfText(pdf))).not.toContain("the carrier's own questions");
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
    const pdf = (await pdfText(await renderApplicationPdf(withEquipment())));
    expect(pdf).toContain("§391.21(b)(6)");
    // The label, not the stored token — a qualification file is read by people.
    expect(pdf).toContain("Tractor and semi-trailer");
    expect(pdf).toContain("Reefer");
    expect(pdf).toContain("420000");
  });

  it("says 'present' for equipment the driver still drives, and prints no invented miles", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(withEquipment())));
    expect(pdf).toContain("present");
    expect(pdf).toContain("Bus");
  });

  /** Every application filed before this field existed has none of it. */
  it("renders a payload that predates the field", async () => {
    const pdf = await renderApplicationPdf(input());
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect((await pdfText(pdf))).toContain("§391.21(b)(6)");
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
    const pdf = (await pdfText(await renderApplicationPdf(input({
      application: { ...APPLICATION, other_names: ["Susan Smith"] } as unknown as DriverApplication,
    }))));
    expect(pdf).toContain("Also known as");
    expect(pdf).toContain("Susan Smith");
  });

  it("prints nothing at all when they gave none, which is the normal case", async () => {
    expect((await pdfText(await renderApplicationPdf(input())))).not.toContain("Also known as");
  });
});

/**
 * The certificate of completion (X7, D-AX8).
 *
 * ⚠ The point of this block is that the document can show HOW each act happened, not only what was
 * signed. Every fact asserted below was already in the database when this file was written and was
 * being left out of the query that feeds the renderer — so the carrier held a better evidentiary
 * record than the document it files, which is the wrong way round for a §391.51 file.
 */
describe("the certificate of completion", () => {
  it("gathers the whole ceremony onto one page, in the order it happened", async () => {
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    expect(pdf).toContain("Certificate of completion");
    // Numbered from the consent: the list reads as a sequence of acts, not an unordered set.
    expect(pdf).toContain("1. Agreed to sign electronically");
    expect(pdf).toContain("2. Consumer report disclosure and authorization");
    expect(pdf).toContain("4. Certified the application");
  });

  it("prints the address and the browser each act came from", async () => {
    // Stored by `record_driver_release` since 0228 and printed by nothing until now.
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    expect(pdf).toContain("From address");
    expect(pdf).toContain("203.0.113.9");
    expect(pdf).toContain("Browser");
    expect(pdf).toContain("iPhone");
  });

  it("stamps each act to the second, in UTC, and says which", async () => {
    // A bare date cannot order two signatures a minute apart, and a local time cannot be compared
    // to anything. §390.32(c) evidence is a moment, not a day.
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    expect(pdf).toContain("2026-08-21 17:50:00 UTC");
    expect(pdf).toContain("2026-08-21 18:00:00 UTC");
  });

  it("names each instrument, and never its database token", async () => {
    // The same defect D-AX3 fixed on the driver's screen — here the reader is an auditor or a court.
    const pdf = (await pdfText(await renderApplicationPdf(input())));
    expect(pdf).toContain("FMCSA Pre-Employment Screening Program (PSP)");
    expect(pdf).not.toContain("fcra_disclosure");
    expect(pdf).not.toContain("psp\n");
  });

  it("renders for an application whose evidence rows are missing pieces", async () => {
    // Every row filed before X7 selected these columns has null in them, and a derivative that
    // throws on an old row is a qualification file that cannot be produced.
    const pdf = (await pdfText(
      await renderApplicationPdf(
        input({
          applicantIp: null,
          applicantUserAgent: null,
          esignConsent: null,
          authorizations: [
            {
              purpose: "fcra_disclosure", disclosure_version: "v1",
              disclosure_text: "text", intent_statement: "intent",
              signed_name: "Susan Godfrey", accepted_at: "2026-08-21T17:50:00Z",
              method: "esign", accepted_ip: null, accepted_user_agent: null,
            },
          ],
        }),
      ),
    ));
    expect(pdf).toContain("Certificate of completion");
    // With no consent the numbering starts at the first instrument, not at a phantom step one.
    expect(pdf).toContain("1. Consumer report disclosure and authorization");
    expect(pdf).toContain("2. Certified the application");
  });
});

/**
 * The certificate's sections, against the sheets they land on (AUD-4, 2026-09-19).
 *
 * ⚠ **Measured before it was fixed, by rendering and looking at 100 dpi**: with all five instruments
 * signed, the permissions PDF's page 9 and this document's page 10 OPENED with `From address` and
 * `Browser` — two rows of an instrument whose heading was on the sheet before, sitting directly
 * above a heading numbered for a different one. On a page whose whole job is to say which act
 * happened when, two rows filed under the wrong act is the worst thing it can do quietly.
 *
 * ⚠ **This is one of the few layout properties a text assertion CAN hold**, and the reason is worth
 * stating: it is about page MEMBERSHIP and ORDER, not about coordinates. `pdfPageTexts` reads the
 * page tree, so "which sheet is this row on" is answerable. *Where on the sheet* is still not, and
 * still needs a raster — see `pdfText.ts`'s own header.
 */
describe("the certificate of completion, section by section", () => {
  /** The labels `certificate()` puts in the left column of an act's rows. */
  const ROW_LABELS = ["Agreed", "Signed as", "Signed", "From address", "Browser"];

  /** A real hire signs all five instruments; the fixture above carries two, and two always fitted. */
  const everyInstrument = AUTHORIZATION_PURPOSES.map((purpose, i) => ({
    purpose,
    disclosure_version: "v1",
    disclosure_text: `The wording that was actually signed for ${purpose}.`,
    intent_statement: `I authorize the ${purpose} act.`,
    signed_name: "Susan Godfrey",
    accepted_at: `2026-08-21T17:5${i}:00Z`,
    method: "esign",
    accepted_ip: "203.0.113.9",
    // ⚠ A real user agent, because it is the row that WRAPS — and the wrap is what pushed the
    // section over the page boundary in the first place.
    accepted_user_agent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
      + "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  }));

  it("never opens a sheet with rows belonging to the section before it", async () => {
    const pages = await pdfPageTexts(
      await renderApplicationPdf(input({ authorizations: everyInstrument })),
    );

    const first = pages.findIndex((t) => t.includes("Certificate of completion"));
    expect(first, "the certificate has to be on the document at all").toBeGreaterThan(-1);
    // Guards the guard: the acts must actually span more than one sheet, or this proves nothing.
    expect(pages.length - first).toBeGreaterThan(1);

    for (const [offset, text] of pages.slice(first).entries()) {
      // Everything before this sheet's first numbered heading belongs to whatever came before it.
      const heading = text.search(/\d+\. [A-Z]/);
      const orphaned = heading === -1 ? text : text.slice(0, heading);
      for (const label of ROW_LABELS) {
        expect(orphaned, `page ${first + offset + 1} opens with "${label}"`).not.toContain(label);
      }
    }
  });

  it("keeps every act's four rows on the sheet its own heading is on", async () => {
    const pages = await pdfPageTexts(
      await renderApplicationPdf(input({ authorizations: everyInstrument })),
    );
    const headings = everyInstrument.map((a, i) => `${2 + i}. ${purposeLabel(a.purpose)}`);
    expect(headings).toHaveLength(5);

    for (const heading of headings) {
      const sheet = pages.find((t) => t.includes(heading));
      expect(sheet, heading).toBeDefined();
      const own = sheet!.slice(sheet!.indexOf(heading));
      for (const label of ["Signed as", "From address", "Browser"]) {
        expect(own, `${heading} → ${label}`).toContain(label);
      }
    }
  });
});
