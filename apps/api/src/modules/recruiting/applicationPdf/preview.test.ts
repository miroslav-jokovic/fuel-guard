import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { pdfPageCount as pageCount, pdfText as textOf } from "../../../testing/pdfText.js";
import { PACKET_PLACEMENTS } from "@silvicom/shared";
import { applicationPreviewPdf, isPreviewError } from "./preview.js";
import { renderPacketDocument } from "./packetDocument.js";

/**
 * The office's printable preview of an application nobody has signed (F6).
 *
 * ⚠ Three things are pinned and they are the three that would hurt. The org filter, because this
 * reads with the service role and a missing one hands another carrier's applicant to whoever asks.
 * The refusal on a FILED application, because re-rendering one would put a second, uncited copy of a
 * §391.51(b)(1) record into circulation. And that the band is actually on the page, because the
 * whole difference between this document and the filing is one boolean.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** A payload in the shape `toDraftPayload` writes one — empty strings, no certification. */
const PAYLOAD = {
  first_name: "Susan", middle_name: "", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Elm St", line2: "", city: "Joliet", state: "IL", postal_code: "60431", from: "2019-04", to: "" }],
  cdl_number: "D1234", cdl_state: "IL", cdl_class: "A", cdl_expires_at: "",
  employers: [], declares_no_employment: false,
  accidents: [], declares_no_accidents: false,
  violations: [], declares_no_violations: false,
  licence_ever_denied: false, licence_denial_detail: "",
  questionnaire: { proof_of_age: true },
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

/**
 * ⚠ A FUNCTION fixture for the invitation, never a flat array. `supabaseRecorder` records `.eq()`
 * and does not apply it, so an array answers another carrier's query with this carrier's row — and a
 * cross-tenant test written against one proves that the fake ignores filters, nothing more.
 */
const seed = (over: { invitation?: Record<string, unknown> | null; payload?: unknown } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: (q) => {
        if (over.invitation === null) return [];
        const row = over.invitation ?? invitation();
        const wanted = q.filters().find((f) => f.col === "org_id")?.val;
        return wanted !== undefined && wanted !== row.org_id ? [] : [row];
      },
      application_drafts: over.payload === null ? [] : [{ payload: over.payload ?? PAYLOAD }],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      driver_authorizations: [],
      esign_consents: [],
      application_captures: [],
      documents: [],
    },
  });

/**
 * The adopted signature, chosen so it appears NOWHERE else in the fixture.
 *
 * ⚠ Not "Susan Godfrey". The applicant's own name is drawn legitimately all over the packet — the
 * name block, the employment grid, the continuation sheet's header — so asserting its absence would
 * fail on a correct preview, and asserting its presence would pass on a broken one. A mark is a
 * different string from a name, and this fixture keeps them different.
 */
const ADOPTED = "S. Q. Vanterpool-Mark";

/** The bare carrier packet, before anything is appended. `packetTemplate.test.ts` pins the number. */
const TEMPLATE_PAGES = 31;

/**
 * One more accident than the carrier's grid holds (Q-PKT10).
 *
 * ⚠ §391.21(b)(7) asks for every accident in the preceding three years and the paper has room for
 * three, so a fourth forces the continuation sheet. That is what makes the page-count test below
 * discriminate rather than merely pass.
 */
const FOUR_ACCIDENTS = [1, 2, 3, 4].map((n) => ({
  date: `2024-0${n}-01`,
  nature: `Accident ${n}`,
  fatalities: 0,
  injuries: 0,
  hazmat_spill: false,
}));

describe("previewing an application before it is signed", () => {
  it("renders the answers that exist, marked as a draft", async () => {
    const result = await applicationPreviewPdf(seed().client, ORG, INV);
    expect(isPreviewError(result)).toBe(false);
    if (isPreviewError(result)) return;
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await textOf(result.pdf);
    expect(text).toContain("Susan Godfrey");
    expect(text).toContain("DRAFT - NOT A SIGNED APPLICATION");
    expect(result.filename).toContain("preview");
  });

  /**
   * ⚠ **The assertion A2 exists for** (§1.1, and the step's own done-when).
   *
   * Between 2026-09-14 and this step the office previewed `render.ts`'s eight-page §391.21 summary
   * while the driver signed the carrier's thirty-one-page packet. **No gate could see it**: both
   * renderers typechecked, both were tested, and each test asserted its own document. The assertion
   * that did not exist is this one — one payload, both paths, and the page counts must agree.
   *
   * ⚠ Page counts rather than bytes, and deliberately. The two documents are NOT byte-identical and
   * must not be: the filing carries twenty-two marks and a certification date, the preview carries a
   * band and blank signature lines. What "the same document" means here is the same PAPER, and the
   * page count is the part of that a reader notices first and a per-renderer test can never check.
   *
   * ⚠ The payload OVERFLOWS its accident grid on purpose. A preview that silently dropped the
   * continuation sheet the filing appends would still match on a payload that fits, so a fixture
   * without overflow could not tell the two implementations apart — this repo's named *fixture too
   * uniform to discriminate* failure. The counts must move together, and both must exceed the bare
   * template.
   */
  it("prints the same paper the driver signs, page for page", async () => {
    const payload = { ...PAYLOAD, accidents: FOUR_ACCIDENTS, declares_no_accidents: false };

    const preview = await applicationPreviewPdf(seed({ payload }).client, ORG, INV);
    expect(isPreviewError(preview)).toBe(false);
    if (isPreviewError(preview)) return;

    const filed = await renderPacketDocument({
      marks: PACKET_PLACEMENTS.map((p) => ({
        placement_id: p.id,
        signed_name: ADOPTED,
        signed_at: "2026-09-12T10:00:00Z",
      })),
      application: payload as never,
      certifiedAt: "2026-09-12T10:00:00Z",
      signedName: ADOPTED,
    });

    const previewPages = await pageCount(preview.pdf);
    expect(previewPages).toBe(await pageCount(filed));
    // Guards the guard: 31 is the bare template, so a pair that both lost the continuation sheet
    // would still be "equal" and would still be the bug.
    expect(previewPages).toBeGreaterThan(TEMPLATE_PAGES);
  });

  /**
   * ⚠ The one line of this module that could forge something. `signedName` is drawn on page 22's
   * `Driver name Print`, beside the signature lines, and the applicant's own name sits two fields
   * away in the payload this module is holding — so a preview that passed it would print a name
   * where a signature belongs on a document nobody has signed.
   *
   * ⚠ **This test went VACUOUS when A2 changed the paper under it and still passed.** It used to
   * slice the §391.21(b)(12) block out of the summary and assert the name was not in it; the packet
   * has no such block, so both `indexOf` calls returned -1, the slice returned `""`, and `""`
   * contains nothing. It proved the absence of a string in an empty string. It now compares the
   * preview against a SIGNED render of the same payload, using an adopted signature that appears
   * nowhere else in it — so the assertion has something to be wrong about.
   */
  it("signs nothing: no adopted mark is drawn on an unsigned preview", async () => {
    const preview = await applicationPreviewPdf(seed().client, ORG, INV);
    expect(isPreviewError(preview)).toBe(false);
    if (isPreviewError(preview)) return;

    const signed = await renderPacketDocument({
      marks: PACKET_PLACEMENTS.map((p) => ({
        placement_id: p.id,
        signed_name: ADOPTED,
        signed_at: "2026-09-12T10:00:00Z",
      })),
      application: PAYLOAD as never,
      certifiedAt: "2026-09-12T10:00:00Z",
      signedName: ADOPTED,
    });

    // The signed one carries it, which is what makes the preview's not carrying it mean something.
    expect(await textOf(signed)).toContain(ADOPTED);
    expect(await textOf(preview.pdf)).not.toContain(ADOPTED);
  });

  /**
   * ⚠ **The other half of "signs nothing", and it needed its own test because the one above cannot
   * see it.** `signedName` arrives on the input whether or not there are any marks, so the question
   * is whether any code path can put it on the paper without one.
   *
   * ⚠ **This test went VACUOUS once before and the shape of the failure is worth keeping.** It used
   * to slice a §391.21(b)(12) block out of the summary and assert the name was not in it; the packet
   * has no such block, so both `indexOf` calls returned -1 and it proved the absence of a string in
   * an empty string. Its replacement then counted a DELTA of one occurrence, because
   * `packetFieldValues.ts` drew `signedName` on page 22's `Driver name Print` — which AUD-18 stopped
   * it doing, since that line asks what the signer is CALLED and now reads the payload like every
   * other printed-name line. So the delta is zero, and this asserts the stronger thing the change
   * makes true: **with no marks, the adopted signature reaches the document nowhere at all.**
   */
  it("draws the adopted signature only where a mark was actually made", async () => {
    const preview = await applicationPreviewPdf(seed().client, ORG, INV);
    expect(isPreviewError(preview)).toBe(false);
    if (isPreviewError(preview)) return;

    const unsigned = await renderPacketDocument({
      marks: [],
      application: PAYLOAD as never,
      certifiedAt: "",
      signedName: ADOPTED,
    });
    const signed = await renderPacketDocument({
      marks: [{ placement_id: "p22", signed_name: ADOPTED, signed_at: "2026-09-12T10:00:00Z" }],
      application: PAYLOAD as never,
      certifiedAt: "",
      signedName: ADOPTED,
    });

    const count = (text: string) => text.split(ADOPTED).length - 1;
    // Guards the guard: one mark puts it on the page once, so zero means something.
    expect(count(await textOf(signed))).toBe(1);
    expect(count(await textOf(unsigned))).toBe(0);
    expect(count(await textOf(preview.pdf))).toBe(0);
    // ⚠ And the applicant's own name IS prefilled on that page, which is what the office previews.
    expect(await textOf(preview.pdf)).toContain("Susan Godfrey");
  });

  /**
   * ⚠ Page 1's `Date:` is the date the applicant CERTIFIED — server-stamped, never invented (D-APP9).
   * Nobody has certified a preview, so the line stays blank like the signature above it. A preview
   * that dated it would be a document asserting an act that has not happened, and the office prints
   * these and posts them.
   */
  it("dates nothing: page one carries no certification date", async () => {
    const preview = await applicationPreviewPdf(seed().client, ORG, INV);
    expect(isPreviewError(preview)).toBe(false);
    if (isPreviewError(preview)) return;

    const dated = await renderPacketDocument({
      marks: [],
      application: PAYLOAD as never,
      certifiedAt: "2026-09-12T10:00:00Z",
      signedName: "",
    });

    // The date appears when one is given, which is what makes its absence here a measurement.
    expect(await textOf(dated)).toContain("2026-09-12");
    expect(await textOf(preview.pdf)).not.toContain("2026-09-12");
  });

  /**
   * ⚠ **Deleted with A2, and recorded rather than quietly dropped:** *"says where it has got to, and
   * moves when the driver hands it over"* asserted the preview printed its progress stage
   * (*"filling it in"* → *"waiting for you"*). That line lived in `render.ts`'s §391.21 summary and
   * the carrier's packet has no page for it, so the capability is gone by design, not by accident —
   * see this module's header for where the three dropped facts go (B2). The stage is on the
   * applicant's record, which is where a recruiter reads it anyway; a document's job is to be the
   * document.
   */

  it("scopes every read to the reader's own org", async () => {
    // The service role bypasses RLS, so the filter is the only thing between two carriers.
    const rec = seed();
    await applicationPreviewPdf(rec.client, ORG, INV);
    // `organizations` is filtered by primary key, which IS the tenant id — the same exemption
    // `file.test.ts` makes for the same read.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("says not found rather than leaking that an invitation exists elsewhere", async () => {
    const result = await applicationPreviewPdf(seed().client, OTHER_ORG, INV);
    expect(isPreviewError(result) && result.code).toBe("application_not_found");
  });

  /**
   * ⚠ The filed application already has a document — hashed into `documents.sha256` and cited by the
   * §391.51(b)(1) row. A second copy rendered here would not match it, and both would be "the
   * application".
   */
  it("refuses once the application is filed, and says where the real one is", async () => {
    const result = await applicationPreviewPdf(
      seed({ invitation: invitation({ submitted_at: "2026-09-11T10:00:00Z" }) }).client,
      ORG,
      INV,
    );
    expect(isPreviewError(result) && result.code).toBe("already_filed");
    expect(isPreviewError(result) && result.message).toContain("applicant's page");
  });

  it("refuses a link nobody has typed into, rather than printing an empty form", async () => {
    const result = await applicationPreviewPdf(seed({ payload: null }).client, ORG, INV);
    expect(isPreviewError(result) && result.code).toBe("nothing_to_preview");
  });

  /**
   * ⚠ The renderer must survive a payload that does not match today's contract, because
   * `application_drafts.payload` is jsonb written by a form whose shape has changed before. A preview
   * that refused to draw is the office losing the document over a key.
   */
  it("draws a barely-started draft rather than refusing it", async () => {
    const result = await applicationPreviewPdf(
      seed({ payload: { first_name: "Sam", unknown_future_key: 1 } }).client,
      ORG,
      INV,
    );
    expect(isPreviewError(result)).toBe(false);
    if (isPreviewError(result)) return;
    expect(await textOf(result.pdf)).toContain("Sam");
  });
});
