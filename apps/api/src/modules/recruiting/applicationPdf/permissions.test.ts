import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { pdfDrawnLines, pdfDrawnRules, pdfPageTexts, pdfText } from "../../../testing/pdfText.js";
import { MARGIN } from "../../../lib/pdfDraw.js";
import { applicationPermissionsPdf, isPermissionsError } from "./permissions.js";
import { renderApplicationPdf, type ApplicationPdfInput } from "./render.js";

/**
 * The office's printable record of what an applicant has signed (B2).
 *
 * ⚠ What is pinned here is what would hurt. The ORG FILTER, because this reads with the service role
 * and a missing one hands another carrier's applicant to whoever asks. That a REVOKED release is not
 * printed as one the carrier may rely on, which is the only error on this document that could cost
 * somebody a lawful basis. That the instrument page is the SAME page the filed application draws,
 * which is A2's lesson applied before the divergence rather than after it. And that the four
 * releases are listed whether or not they were signed — a document that printed only the pages it
 * had would read as complete whatever was missing.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/**
 * Strings that appear NOWHERE else in the fixture, so an assertion about them has something to be
 * wrong about. The repo's named failure is a fixture too uniform to discriminate.
 */
const FCRA_TEXT = "FCRA-DISCLOSURE-BODY-AS-IT-WAS-SHOWN";
const PSP_TEXT = "PSP-DISCLOSURE-BODY-AS-IT-WAS-SHOWN";
const CONSENT_TEXT = "SEVEN-THOUSAND-AND-ONE-C-SIX-CLAUSES";

/**
 * A consent composed the way the real one is — label, clause, blank line — because the fixture above
 * is ONE LINE and one line cannot show AUD-21 (2026-09-20).
 *
 * ⚠ `esignConsentBody()` joins a label to its clause with `\n` and the clauses to each other with
 * `\n\n`, sixteen breaks in all. Every one of them printed as `?` and no assertion in this file could
 * see it, because `CONSENT_TEXT` has no break to lose. A fixture that cannot express the defect is
 * the repo's named cause of a green test proving nothing.
 */
const CLAUSE_LABEL = "CLAUSE-LABEL-THAT-MUST-OPEN-ITS-OWN-LINE";
const SECOND_LABEL = "SECOND-CLAUSE-LABEL-LIKEWISE";
const CONSENT_CLAUSES =
  `${CLAUSE_LABEL}\nFIRST-CLAUSE-BODY-AS-IT-WAS-SHOWN\n\n${SECOND_LABEL}\nSECOND-CLAUSE-BODY-AS-IT-WAS-SHOWN`;

const grant = (over: Record<string, unknown> = {}) => ({
  id: "auth-fcra",
  purpose: "fcra_disclosure",
  disclosure_version: "fcra-2026-08-19",
  disclosure_text: FCRA_TEXT,
  intent_statement: "I authorise the carrier to obtain a consumer report.",
  signed_name: "Susan Godfrey",
  accepted_at: "2026-09-11T14:07:33Z",
  method: "esign",
  accepted_ip: "203.0.113.7",
  accepted_user_agent: "Mozilla/5.0 (iPhone)",
  revokes: null,
  revoke_reason: null,
  ...over,
});

const PSP_GRANT = grant({
  id: "auth-psp",
  purpose: "psp",
  disclosure_version: "psp-2026-08-19",
  disclosure_text: PSP_TEXT,
  intent_statement: "I authorise the carrier to obtain my PSP report.",
  accepted_at: "2026-09-11T14:09:01Z",
});

const CONSENT = {
  disclosure_version: "esign-2026-08-19",
  disclosure_text: CONSENT_TEXT,
  intent_statement: "I agree to sign electronically.",
  consented_at: "2026-09-11T14:06:12Z",
  withdrawn_at: null,
  applicant_ip: "203.0.113.7",
  applicant_user_agent: "Mozilla/5.0 (iPhone)",
};

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV,
  org_id: ORG,
  driver_id: DRIVER,
  review_requested_at: null,
  approved_at: null,
  submitted_at: null,
  ...over,
});

const CERTIFIED_APPLICATION = {
  id: "11111111-2222-4333-8444-555555555555",
  signed_name: "Susan Godfrey",
  certified_at: "2026-09-14T16:20:00Z",
  applicant_ip: "203.0.113.9",
  applicant_user_agent: "Mozilla/5.0 (iPhone)",
};

/**
 * What a REHIRE's earlier application left behind: the same driver, a different invitation.
 *
 * ⚠ This is the fixture that makes the step's one real decision testable. B2 is invitation-keyed, and
 * a driver-keyed read would look identical on every fixture where a driver has applied once — so the
 * rows below exist under the other invitation and must not reach the document.
 */
const REHIRE_TEXT = "FCRA-DISCLOSURE-FROM-THE-APPLICATION-BEFORE-THIS-ONE";
const REHIRE_GRANT = grant({
  id: "auth-fcra-2024",
  disclosure_version: "fcra-2024-01-01",
  disclosure_text: REHIRE_TEXT,
  accepted_at: "2024-02-02T10:00:00Z",
});

/**
 * ⚠ FUNCTION fixtures, never flat arrays, and for two different reasons.
 *
 * `supabaseRecorder` records `.eq()` and does not apply it, so a flat array answers another carrier's
 * query with this carrier's row — a cross-tenant test written against one proves that the fake
 * ignores filters, nothing more. The same hole hides the KEY: a read that asked for the driver's
 * authorizations rather than this invitation's would be handed the fixture either way, and the one
 * decision this step had to make would be untested. So every invitation-keyed table below answers
 * only a query that actually asked for this invitation.
 */
const keyedOnInvitation = (
  rows: unknown[],
  elsewhere: unknown[] = [],
) => (q: { filters(): Array<{ col: string; val: unknown }> }) => {
  const filters = q.filters();
  const org = filters.find((f) => f.col === "org_id")?.val;
  if (org !== undefined && org !== ORG) return [];
  return filters.find((f) => f.col === "invitation_id")?.val === INV ? rows : elsewhere;
};

const seed = (
  over: {
    invitation?: Record<string, unknown> | null;
    authorizations?: unknown[];
    consent?: unknown;
    application?: unknown;
    draft?: unknown[];
  } = {},
) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: (q) => {
        if (over.invitation === null) return [];
        const row = over.invitation ?? invitation();
        const wanted = q.filters().find((f) => f.col === "org_id")?.val;
        return wanted !== undefined && wanted !== row.org_id ? [] : [row];
      },
      driver_authorizations: keyedOnInvitation(over.authorizations ?? [grant(), PSP_GRANT], [
        REHIRE_GRANT,
      ]),
      esign_consents: keyedOnInvitation(over.consent === null ? [] : [over.consent ?? CONSENT]),
      drivers: [{ first_name: "Susan", last_name: "Godfrey" }],
      driver_applications: keyedOnInvitation(over.application ? [over.application] : []),
      application_drafts: keyedOnInvitation(over.draft ?? []),
      organizations: [{ name: "Silvicom Inc", legal_address: "1 Dock Rd, Joliet IL" }],
      application_captures: [],
      documents: [],
    },
  });

const rendered = async (rec: ReturnType<typeof seed>, org = ORG): Promise<Buffer> => {
  const result = await applicationPermissionsPdf(rec.client, org, INV);
  expect(isPermissionsError(result)).toBe(false);
  if (isPermissionsError(result)) throw new Error(result.code);
  expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  return result.pdf;
};

const printed = async (rec: ReturnType<typeof seed>, org = ORG): Promise<string> =>
  pdfText(await rendered(rec, org));

describe("printing what an applicant has signed", () => {
  it("prints the instruments, and says on every page that it is not the application", async () => {
    const text = await printed(seed());

    expect(text).toContain("Susan Godfrey");
    expect(text).toContain(FCRA_TEXT);
    expect(text).toContain(PSP_TEXT);
    expect(text).toContain(CONSENT_TEXT);
    // The band, which is the only thing on a loose photocopy that can stop it being filed as the
    // §391.21 application.
    expect(text).toContain("SIGNED PERMISSIONS - NOT THE APPLICATION");
    // ⚠ The certificate's closing sentence names what the footer digest is over, and on this document
    // that is the signed rows rather than the answers. A page telling a reader to match it against
    // something the digest is not over is a claim nobody can check.
    expect(text).toContain("digest of the signed permissions");
  });

  /**
   * ⚠ **The assertion A2 exists for, written before the divergence instead of after it.**
   *
   * Between 2026-09-14 and A2 the office previewed one renderer while the driver signed another; both
   * typechecked, both were tested, and each test asserted its own document. The instrument page is
   * the page a dispute is actually about — FCRA §604(b)(2) asks which wording was shown — so this
   * runs ONE authorization through both callers of `instrumentPages.ts` and compares the block
   * character for character. A second implementation of that page cannot survive this test.
   */
  it("draws an instrument exactly as the filed application draws it", async () => {
    const filedInput: ApplicationPdfInput = {
      carrier: { name: "Silvicom Inc", address: "1 Dock Rd, Joliet IL" },
      application: { first_name: "Susan", last_name: "Godfrey" } as never,
      applicationId: CERTIFIED_APPLICATION.id,
      certifiedAt: CERTIFIED_APPLICATION.certified_at,
      signedName: "Susan Godfrey",
      applicantIp: null,
      applicantUserAgent: null,
      signatureMark: null,
      authorizations: [grant()],
      preview: null,
      esignConsent: CONSENT,
    };
    const filedText = await pdfText(await renderApplicationPdf(filedInput));

    // The block as the FILED document draws it: heading, version, the stored text, the intent
    // sentence, the typed name and the date. Sliced out of the real document rather than written
    // here, so this cannot pass by agreeing with a copy of the expectation.
    const start = filedText.indexOf("Authorization - Consumer report disclosure");
    const end = filedText.indexOf("2026-09-11", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = filedText.slice(start, end + "2026-09-11".length);
    // Guards the guard: a block that lost the disclosure text would be a substring of anything.
    expect(block).toContain(FCRA_TEXT);

    expect(await printed(seed())).toContain(block);
  });

  /**
   * The metadata lines, where this document actually puts them (AUD-8, 2026-09-20).
   *
   * ⚠ **`pdfDraw.test.ts` pins the PRIMITIVE and cannot see a call site.** `caption()` can be
   * correct in every unit test while one of these pages goes back to calling `muted()`, and every
   * string assertion in this file — including the character-for-character block comparison above —
   * stays green either way, because the words do not move when the leading does. So this reads the
   * rendered document's own baselines and asks the question a reader asks: does `Version v0-draft`
   * belong to the authorization named above it, or to the paragraph under it?
   *
   * ⚠ It walks EVERY instrument page rather than the first. `find` returning the same page four
   * times, with three never checked, is how AUD-19 passed on a defect it had been written to catch.
   */
  it("sets each page's metadata line as a caption on the block it introduces", async () => {
    const lines = await pdfDrawnLines(await rendered(seed()));
    const at = (text: string, from = 0): number => {
      const i = lines.findIndex((l, n) => n >= from && l.text.includes(text));
      expect(i, text).toBeGreaterThan(-1);
      return i;
    };

    /**
     * ⚠ **The document's own lede is judged against the RULE, not against the rows, and the first
     * version of this assertion was vacuous for want of that.** It compared the title-to-lede step
     * with the lede-to-`Carrier` step and passed on the defect, because the second span crosses the
     * lede's own second line and is larger whatever the leading is. What is actually wrong on this
     * sheet is that the rule sat 7.65pt under the lede and 10.39pt above the rows — an underline on
     * the lede rather than a separator between the two blocks.
     */
    const ledeEnd = at("It is not the \u00a7391.21 application");
    const ownLeading = lines[ledeEnd]!.y - lines[ledeEnd - 1]!.y;
    expect(ownLeading).toBeGreaterThan(0);
    const separator = (await pdfDrawnRules(await rendered(seed())))
      .find((r) => r.page === lines[ledeEnd]!.page);
    expect(separator).toBeDefined();
    expect(separator!.y - lines[ledeEnd]!.y).toBeGreaterThan(ownLeading);

    // ⚠ And one per instrument page. Two instruments are seeded and the consent page carries the
    // same shape, so this is three distinct pages, asserted separately rather than folded into a
    // count — a count is satisfied by the same page three times.
    // ⚠ The VERSION strings, which differ per instrument in this fixture — searching for the word
    // "Version" from a page's heading forward finds the NEXT page's when its own is worded
    // differently, and the assertion then compares two pages and passes on both being wrong.
    const captions: Array<[string, string, string]> = [
      ["Consent to transact electronically", "version esign-2026-08-19", CONSENT_TEXT],
      ["Authorization - Consumer report disclosure", "Version fcra-2026-08-19", FCRA_TEXT],
      ["Authorization - FMCSA Pre-Employment", "Version psp-2026-08-19", PSP_TEXT],
    ];
    const seen = new Set<number>();
    for (const [pageHeading, versionLine, disclosure] of captions) {
      const h = at(pageHeading);
      const version = at(versionLine, h);
      const block = at(disclosure, version);
      expect(lines[version]!.page, pageHeading).toBe(lines[h]!.page);
      expect(seen.has(lines[h]!.page), `${pageHeading} shares a page`).toBe(false);
      seen.add(lines[h]!.page);
      // The finding, per page: it used to sit 15.34pt below its heading and 10.18pt above the
      // wording, which reads as a line of that wording rather than as a note about it.
      expect(lines[version]!.y - lines[h]!.y, pageHeading)
        .toBeLessThan(lines[block]!.y - lines[version]!.y);
    }
    expect(seen.size).toBe(3);
  });

  /**
   * ⚠ Half of "what has this applicant signed" is what they have NOT. `APPLICATION_RELEASE_ORDER` has
   * five purposes and this fixture signs two, so a summary that listed only the pages it had would
   * read as complete while three lawful bases were missing.
   */
  it("lists the releases nobody has signed, not only the ones they have", async () => {
    const text = await printed(seed());
    expect(text).toContain("Previous-employer safety performance release");
    expect(text).toContain("Controlled substances and alcohol testing consent");
    expect(text).toContain("Not signed yet");
    // And the two that ARE signed do not say it — otherwise the assertion above passes on a document
    // that says "Not signed yet" against every row.
    expect(text).toContain("wording fcra-2026-08-19");
  });

  /**
   * ⚠ D-AF4 (2026-09-24): the Clearinghouse limited-query consent is the fifth release. The paper
   * lists it as a row, and no longer prints the sentence that said it "is given inside the FMCSA
   * portal" — which would now sit directly under the row it denies.
   */
  it("lists the Clearinghouse consent as a release, with no sentence disowning it", async () => {
    const text = await printed(seed());
    expect(text).toContain("Drug & Alcohol Clearinghouse query consent");
    expect(text).not.toContain("given inside the FMCSA");
  });

  /**
   * ⚠ **The one error on this document that could cost somebody a lawful basis.** The table is
   * append-only, so a revocation is another row and "is this in force" is a fold (D-REC3). The filed
   * document's reader drops revocation rows and keeps the grant, which is right for a record of what
   * was signed on the day and wrong for a document answering *what may we rely on now* — so this
   * module reads both kinds of row and folds them with `liveAuthorization`, the same fold
   * `AuthorizationsPanel` uses.
   */
  it("does not print a revoked release as one the carrier may rely on", async () => {
    const revocation = grant({
      id: "auth-fcra-revoked",
      revokes: "auth-fcra",
      revoke_reason: "The applicant withdrew it by telephone.",
      accepted_at: "2026-09-12T09:00:00Z",
    });
    const text = await printed(seed({ authorizations: [grant(), PSP_GRANT, revocation] }));

    expect(text).toContain("REVOKED 2026-09-12");
    expect(text).toContain("The applicant withdrew it by telephone.");
    // ⚠ The revoked one must not read like the live one. `wording fcra-…` is the summary line a
    // release in force gets, and the PSP release still has it — so this pins the DIFFERENCE rather
    // than a document that lost its summary altogether.
    expect(text).not.toContain("wording fcra-2026-08-19");
    expect(text).toContain("wording psp-2026-08-19");
    // The page is still printed: a revoked release is evidence of what somebody was shown, and the
    // FCRA wording is the fact a dispute turns on.
    expect(text).toContain(FCRA_TEXT);
  });

  /**
   * How a revocation is TYPESET, which is a different question from whether it is printed (AUD-9).
   *
   * ⚠ **The test above pins the words and passed throughout the defect.** A revocation was drawn as
   * red prose at reading size, in the flow, between the version caption and the disclosure — the
   * same 9.5pt as the wording under it and separated from it by less than that wording's own line
   * spacing. Every string was on the page. It simply read as the opening paragraph of the
   * disclosure rather than as the one fact on the sheet that changes what the carrier may do.
   *
   * ⚠ **Three claims, because any one alone is satisfiable by something still wrong**: bounded (so
   * it is not body copy), the status word FIRST and bold (so a black-and-white photocopy leads with
   * it — D-AVI22 forbids colour carrying alone), and clear of the wording it is not part of.
   */
  it("bounds a revocation so it cannot be read as the first paragraph of the wording", async () => {
    const revocation = grant({
      id: "auth-fcra-revoked",
      revokes: "auth-fcra",
      revoke_reason: "The applicant withdrew it by telephone.",
      accepted_at: "2026-09-12T09:00:00Z",
    });
    const pdf = await rendered(seed({ authorizations: [grant(), PSP_GRANT, revocation] }));
    const lines = await pdfDrawnLines(pdf);

    /**
     * ⚠ **`UTC`, and the first version of this test was wrong without it.** The summary on sheet one
     * now opens its lapsed rows with `REVOKED` too, so a bare `startsWith("REVOKED")` returns the
     * SUMMARY row — a different page, with no notice and no wording on it — and every assertion
     * below then measures the wrong thing. The notice stamps to the second (`stamp()`); the summary
     * carries a date (`date()`). AUD-19 lost a whole test to `find` answering with the wrong one.
     */
    const headline = lines.find((l) => l.text.startsWith("REVOKED") && l.text.endsWith("UTC"));
    expect(headline, "the headline leads with the status word").toBeDefined();
    expect(headline!.color).toBe("#a11c1c");

    // ⚠ Bold is asserted against a run KNOWN to be bold on the same sheet rather than against a
    // literal `/F2`, which would pin pdfkit's resource-allocation order and not a weight. Every
    // `field()` value is Helvetica-Bold, and `Signed`'s value is on this page.
    const onPage = lines.filter((l) => l.page === headline!.page);
    const boldValue = onPage.find((l) => l.text === "Susan Godfrey");
    expect(boldValue, "a known-bold run to measure against").toBeDefined();
    expect(headline!.font).toBe(boldValue!.font);
    // ...and the detail under it is NOT bold, so "bold" above is a real distinction on this page.
    const detail = onPage.find((l) => l.text.startsWith("The carrier may not rely"));
    expect(detail, "the detail sentence").toBeDefined();
    expect(detail!.font).not.toBe(boldValue!.font);
    expect(detail!.color).toBe("#a11c1c");

    // ⚠ BOUNDED: the instrument page draws no rule of its own, so the two here are the notice's,
    // and they must sit either side of it. A page whose notice lost its box has none at all.
    const rules = (await pdfDrawnRules(pdf)).filter((r) => r.page === headline!.page);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.y).toBeLessThan(headline!.y);
    expect(rules[1]!.y).toBeGreaterThan(detail!.y);

    // And the wording begins below the box, not inside it.
    const wording = onPage.find((l) => l.text.includes(FCRA_TEXT));
    expect(wording, "the disclosure text").toBeDefined();
    expect(wording!.y).toBeGreaterThan(rules[1]!.y);
  });

  /**
   * ⚠ **The summary column is the page the office actually reads, and the audit did not name it.**
   * It read `Signed 2026-09-13 · REVOKED 2026-09-16` — a lapsed row and a live one opened with the
   * same word in the same ink, so five rows could only be told apart by reading each to its end.
   * The status leads now, and a lapsed row is drawn in DANGER. ⚠ The live row is asserted too: a
   * document that coloured every row would satisfy the first half and say nothing.
   */
  it("opens a lapsed summary row with its status, and leaves a live one alone", async () => {
    const revocation = grant({
      id: "auth-fcra-revoked",
      revokes: "auth-fcra",
      revoke_reason: "The applicant withdrew it by telephone.",
      accepted_at: "2026-09-12T09:00:00Z",
    });
    const lines = await pdfDrawnLines(
      await rendered(
        seed({
          authorizations: [grant(), PSP_GRANT, revocation],
          consent: { ...CONSENT, withdrawn_at: "2026-09-17T11:30:00Z" },
        }),
      ),
    );
    // The summary is on sheet one; the instrument pages repeat these words with other geometry.
    const summary = lines.filter((l) => l.page === 0);
    const value = (starts: string): (typeof lines)[number] => {
      const line = summary.find((l) => l.text.startsWith(starts));
      expect(line, starts).toBeDefined();
      return line!;
    };

    expect(value("REVOKED 2026-09-12").color).toBe("#a11c1c");
    expect(value("WITHDRAWN 2026-09-17").color).toBe("#a11c1c");
    // ⚠ The release still in force: same column, same page, ordinary ink and opening with `Signed`.
    const live = value("Signed 2026-09-11");
    expect(live.color).toBe("#1a1a1a");
    expect(live.x).toBe(value("REVOKED 2026-09-12").x);
  });

  /**
   * The consent prints with the breaks it was composed with, and the breaks it was SIGNED with.
   *
   * ⚠ **The screen and the filed document disagreed, and the screen was right.**
   * `EsignConsentGate.vue` renders this same stored string under `whitespace-pre-line`, with a
   * comment saying *"because the clauses are composed with their own line breaks"*. The applicant
   * read six labelled clauses, signed them, and the PDF of that consent printed run-on prose with a
   * `?` at every break — `winAnsi`'s catch-all ate `\n` before pdfkit could honour it. A2's defect
   * in another guise: one document, two renderers, disagreeing about what was shown.
   *
   * ⚠ Asserted on the DRAWN RUNS, not on the text. `pdfText` concatenates every run, so a label that
   * ran into its clause and a label on its own line produce the same string and the same `toContain`.
   */
  it("prints the consent's clauses on their own lines, as the applicant was shown them", async () => {
    const lines = await pdfDrawnLines(
      await rendered(seed({ consent: { ...CONSENT, disclosure_text: CONSENT_CLAUSES } })),
    );
    const label = lines.find((l) => l.text === CLAUSE_LABEL);
    expect(label, "the first clause label, alone on its line").toBeDefined();
    // ⚠ BOTH labels: one break working proves nothing about the `\n\n` that separates clauses, and
    // the first label is the one case that would survive even if every later break were eaten.
    expect(lines.find((l) => l.text === SECOND_LABEL), "the second label").toBeDefined();

    // ⚠ And nothing on that sheet was folded to a question mark. The fixture carries none of its
    // own, so this counts corruption rather than punctuation.
    expect(CONSENT_CLAUSES).not.toContain("?");
    const marks = lines.filter((l) => l.page === label!.page && l.text.includes("?"));
    expect(marks.map((l) => l.text)).toEqual([]);
  });

  /**
   * WHERE the band is drawn, which is the half of "it says so on every page" that words cannot hold
   * (AUD-10).
   *
   * ⚠ **The text assertion above passed throughout the defect and would pass again tomorrow.** The
   * band was a 30pt diagonal through the middle of the sheet: on the six pages with room it landed
   * in white space, and on the certificate it ran through the evidence rows of four sections. Every
   * character of it was in the content stream either way, which is exactly the family of defect this
   * file's geometry reader exists for.
   *
   * ⚠ **The fixture certifies, so the certificate — the sheet the finding names — is one of the
   * pages this walks.** It is NOT a density guard, and the honest reason is worth writing down: the
   * old defect depended on how full a page was, and this one cannot. Measured on this fixture, the
   * certificate page carries 50 runs reaching y576 of a 720pt text block, and the assertions below
   * hold identically on the emptiest sheet in the document. **That is the improvement** — the band
   * clearing the text stopped being a property of the content and became a property of the page.
   *
   * ⚠ **Both directions are pinned, and each one alone is satisfiable by something still wrong.**
   * The band above the text block (a band in the block is the defect) AND every drawn line of the
   * document below it (a text block that grew into the margin is the same collision arriving from
   * the other side — and `stamp.ts` claims it cannot, because pdfkit paginates against the margin).
   *
   * ⚠ A band that went back to being a rotated diagonal does not fail an assertion about its
   * position: it DISAPPEARS from `pdfDrawnLines`, which only matches pdfkit's upright text matrix.
   * That is why the first assertion in the loop is that the band was found at all.
   */
  it("keeps the band in the margin, clear of every line the document prints", async () => {
    const pdf = await rendered(seed({ application: CERTIFIED_APPLICATION }));
    const lines = await pdfDrawnLines(pdf);

    expect(
      lines.find((l) => l.text === "Certificate of completion"),
      "the page AUD-10 was found on is among the sheets below",
    ).toBeDefined();

    for (const page of new Set(lines.map((l) => l.page))) {
      const onPage = lines.filter((l) => l.page === page);
      const band = onPage.find((l) => l.text === "SIGNED PERMISSIONS - NOT THE APPLICATION");
      expect(band, `page ${page + 1} carries the band, upright`).toBeDefined();
      expect(band!.y, `page ${page + 1}: the band is in the top margin`).toBeLessThan(MARGIN);

      const printed = onPage.filter((l) => l !== band);
      const highest = Math.min(...printed.map((l) => l.y));
      expect(highest, `page ${page + 1}: nothing is printed in the band's margin`)
        .toBeGreaterThan(MARGIN);
      // ⚠ Not merely "above it": a band at y45 would satisfy both assertions above with 1pt between
      // its descenders and the top of the title, and read as an eyebrow on the document's name
      // rather than as the sheet's rubric. Measured clearance is 21.9pt — two lines of its own type.
      expect(MARGIN - band!.y, `page ${page + 1}: the band stands clear of the text block`)
        .toBeGreaterThan(band!.size * 2);
    }
  });

  /**
   * The certificate's closing note is never the only thing on a sheet (AUD-20).
   *
   * ⚠ **`pdfDraw.test.ts` pins the MECHANISM and cannot pin this.** That suite proves `section()`
   * keeps a colophon with its rows at every height on the page; it says nothing about whether this
   * document still draws its closing note loose in the flow underneath the section, which is what it
   * did until today and what the defect actually was.
   *
   * ⚠ **The fixture is the one that reproduced it**, not a convenient one: THREE instruments and a
   * real 130-character user agent on every act, which is what put `to its source.` alone on page 7
   * of 7 with 0.9% of the text block used. Two instruments, or a short user agent, and the note lands
   * mid-sheet whatever the code does — so a test written on the default fixture would be green on
   * the defect.
   */
  it("keeps the certificate's closing note on the sheet that carries the last act", async () => {
    const LONG_UA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
      + "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const onLongUa = (over: Record<string, unknown>) => grant({ ...over, accepted_user_agent: LONG_UA });

    const pages = await pdfPageTexts(await rendered(seed({
      authorizations: [
        onLongUa({}),
        onLongUa({ id: "auth-psp", purpose: "psp", disclosure_text: PSP_TEXT, accepted_at: "2026-09-11T14:09:01Z" }),
        onLongUa({ id: "auth-mvr", purpose: "mvr", disclosure_text: "MVR-DISCLOSURE-BODY", accepted_at: "2026-09-11T14:10:20Z" }),
      ],
      consent: { ...CONSENT, applicant_user_agent: LONG_UA },
      application: { ...CERTIFIED_APPLICATION, applicant_user_agent: LONG_UA },
    })));

    const TAIL = "to its source.";
    const sheet = pages.findIndex((t) => t.includes("Certified the application"));
    expect(sheet, "the last act is on the document").toBeGreaterThanOrEqual(0);
    expect(pages[sheet], "the note ends on the sheet that carries the last act").toContain(TAIL);
    // ⚠ And no sheet is left holding a fragment of it. This is the assertion that fails on the
    // defect: the page above kept `…can be matched` and this one took the three words after it.
    const strays = pages
      .map((text, i) => ({ text, i }))
      .filter(({ text, i }) => i !== sheet && text.includes(TAIL))
      .map(({ i }) => i);
    expect(strays, "no other sheet carries part of the closing note").toEqual([]);
  });

  /**
   * ⚠ Where `preview.ts` refuses, this one does not, and the difference is deliberate: the filed
   * record is the carrier's 31-page packet, which has no page for the releases, the consent or the
   * certificate of completion. After filing this is still the only document that carries them.
   */
  it("still prints after the application is filed, and dates the certification", async () => {
    const text = await printed(
      seed({
        invitation: invitation({ submitted_at: "2026-09-14T16:20:00Z" }),
        application: CERTIFIED_APPLICATION,
      }),
    );
    expect(text).toContain("2026-09-14 16:20:00 UTC");
    expect(text).not.toContain("Not signed yet. The applicant certifies");
  });

  /**
   * ⚠ And before it is filed the certificate says so in a sentence. Four rows of em dashes would read
   * as evidence that failed to record rather than as an act still owed — `certificate.ts`'s own note.
   */
  it("says the application has not been certified while it has not", async () => {
    const text = await printed(seed());
    expect(text).toContain("Not signed yet. The applicant certifies");
    expect(text).not.toContain("2026-09-14 16:20:00 UTC");
  });

  /**
   * ⚠ **The step's one real decision, pinned rather than left in a header.** Driver-keyed or
   * invitation-keyed was written down as a question with a recommendation, and this is the assertion
   * that makes the answer hold: a rehire's earlier signatures belong to their own application, and a
   * document spanning two invitations could not be dated. The releases PANEL stays driver-keyed —
   * a recruiter looking at a person wants everything that person ever signed — so the two really do
   * key differently, and only a fixture that answers differently by key can tell.
   */
  it("keys the instruments on this invitation, not on the driver", async () => {
    const text = await printed(seed());
    expect(text).toContain(FCRA_TEXT);
    expect(text).not.toContain(REHIRE_TEXT);
  });

  it("says nothing is signed rather than printing a sheet of empty rows", async () => {
    const result = await applicationPermissionsPdf(
      seed({ authorizations: [], consent: null }).client,
      ORG,
      INV,
    );
    expect(isPermissionsError(result) && result.code).toBe("nothing_signed_yet");
  });

  it("scopes every read to the reader's own org", async () => {
    // The service role bypasses RLS, so the filter is the only thing between two carriers.
    const rec = seed();
    await applicationPermissionsPdf(rec.client, ORG, INV);
    // `organizations` is filtered by primary key, which IS the tenant id — the same exemption
    // `preview.test.ts` and `file.test.ts` make for the same read.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("says not found rather than leaking that an invitation exists elsewhere", async () => {
    const result = await applicationPermissionsPdf(seed().client, OTHER_ORG, INV);
    expect(isPermissionsError(result) && result.code).toBe("application_not_found");
  });
});
