import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { pdfText as textOf } from "../../testing/pdfText.js";
import { applicationPreviewPdf, isPreviewError } from "./applicationPdf/preview.js";
import { applicantReadingCopy } from "./applicationReadingCopy.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { APPLICATION_CAPTURE_MARK_SLOT } from "@silvicom/shared";

/**
 * The packet a driver reads before they sign it (C1).
 *
 * ⚠ Four things are pinned and they are the four that would hurt. That it does NOT carry the DRAFT
 * band (D-HUI10), because the band is the whole difference between this document and the one the
 * office reads, and a stripe saying the paper is provisional is the opposite of what this is for.
 * That the marks already collected ARE drawn (D-HUI11), because a driver resuming at stop 8 has
 * seven signatures on that paper and a copy that hid them would be showing them a different
 * document. That it serves BEFORE the office has approved anything (D-HUI12), because reading is
 * not signing. And the org filter, because this reads with the service role.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_ORG = "99999999-8888-4777-8666-555555555555";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TOKEN = "b".repeat(43);
const NOW = new Date("2026-09-19T12:00:00Z");

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

/**
 * The adopted mark, chosen so it appears NOWHERE else in the fixture — `preview.test.ts`'s reasoning
 * exactly. "Susan Godfrey" is drawn legitimately all over the packet, so asserting its presence
 * would pass on a renderer that drew no marks at all.
 */
const ADOPTED = "S. Q. Vanterpool-Mark";

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV,
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2099-01-01T00:00:00Z",
  revoked_at: null,
  consented_at: "2026-09-14T08:00:00Z",
  releases_completed_at: "2026-09-15T08:00:00Z",
  // ⚠ NOT approved, on the default fixture. D-HUI12 is that reading does not wait for the office,
  // so the ordinary case here is a link the office has not got to yet.
  review_requested_at: null,
  approved_at: null,
  submitted_at: null,
  ...over,
});

/**
 * ⚠ FUNCTION fixtures, never flat arrays. `supabaseRecorder` records `.eq()` and does not apply it,
 * so an array hands this carrier's row to a query that asked for another carrier's — and the
 * cross-tenant test below would then prove only that the fake ignores filters.
 */
const seed = (
  over: { invitation?: Record<string, unknown> | null; payload?: unknown; marks?: unknown[] } = {},
) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: (q) => {
        if (over.invitation === null) return [];
        const row = over.invitation ?? invitation();
        const wanted = q.filters().find((f) => f.col === "org_id")?.val;
        return wanted !== undefined && wanted !== row.org_id ? [] : [row];
      },
      application_packet_marks: (q) => {
        const rows = over.marks ?? [];
        const wanted = q.filters().find((f) => f.col === "org_id")?.val;
        return wanted !== undefined && wanted !== ORG ? [] : rows;
      },
      application_drafts: over.payload === null ? [] : [{ payload: over.payload ?? PAYLOAD }],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      driver_authorizations: [],
      esign_consents: [],
      application_captures: [],
      documents: [],
    },
  });

/** p03 is the first driver placement, and a signature rather than initials. */
const signedP03 = [{ placement_id: "p03", signed_name: ADOPTED, signed_at: "2026-09-18T10:00:00Z" }];

describe("the packet a driver reads before signing it", () => {
  it("serves the carrier's paper with no DRAFT band across it", async () => {
    const result = await applicantReadingCopy(seed().client, TOKEN, NOW);
    expect(isIntakeError(result)).toBe(false);
    if (isIntakeError(result)) return;
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const text = await textOf(result.pdf);
    expect(text).toContain("Susan Godfrey");
    // D-HUI10. The office's own preview of the SAME invitation carries it — the contrast is the
    // assertion, because "does not contain" on its own would pass on a renderer that drew nothing.
    expect(text).not.toContain("DRAFT - NOT A SIGNED APPLICATION");
    expect(result.filename).toBe("your-application.pdf");
    expect(result.filename).not.toContain("preview");
  });

  /**
   * ⚠ The contrast that makes the assertion above mean something. One invitation, one renderer, two
   * audiences: the office still gets its band and the driver does not. If the band option ever stops
   * being read, this test fails on the office's half rather than silently agreeing with the driver's.
   */
  it("still bands the office's preview of the very same application", async () => {
    const rec = seed();
    const driver = await applicantReadingCopy(rec.client, TOKEN, NOW);
    const office = await applicationPreviewPdf(seed().client, ORG, INV);
    expect(isIntakeError(driver)).toBe(false);
    expect(isPreviewError(office)).toBe(false);
    if (isIntakeError(driver) || isPreviewError(office)) return;
    expect(await textOf(office.pdf)).toContain("DRAFT - NOT A SIGNED APPLICATION");
    expect(await textOf(driver.pdf)).not.toContain("DRAFT - NOT A SIGNED APPLICATION");
  });

  /**
   * D-HUI11 — and ⚠ this is NOT A2's rejected marks-based switch. That switch asked "has this been
   * signed?" and used the answer to choose a different DOCUMENT; this passes the real mark set to
   * one renderer and changes nothing about which paper is drawn.
   */
  it("draws the signatures already on the paper, for a driver coming back", async () => {
    const withMark = await applicantReadingCopy(seed({ marks: signedP03 }).client, TOKEN, NOW);
    expect(isIntakeError(withMark)).toBe(false);
    if (isIntakeError(withMark)) return;
    expect(withMark.markCount).toBe(1);
    expect(await textOf(withMark.pdf)).toContain(ADOPTED);

    // ⚠ The other half, so the fixture can discriminate: a walk nobody has started must NOT have the
    // mark on it. Without this, a renderer that stamped the adopted name on every packet would pass.
    const fresh = await applicantReadingCopy(seed().client, TOKEN, NOW);
    expect(isIntakeError(fresh)).toBe(false);
    if (isIntakeError(fresh)) return;
    expect(fresh.markCount).toBe(0);
    expect(await textOf(fresh.pdf)).not.toContain(ADOPTED);
  });

  /**
   * D-HUI12. `POST /:token/mark` answers `packet_not_yet_approved` while the office is still
   * reading, and that is right — signing is the act that waits. Reading is not signing, and a driver
   * who opens their link the evening they send it is owed the document before they are asked for a
   * signature on it.
   */
  it("serves it before the office has approved anything", async () => {
    // The default fixture is deliberately unapproved; this states the property rather than leaving
    // it implicit in every other test here.
    const unapproved = seed({ invitation: invitation({ review_requested_at: null, approved_at: null }) });
    const result = await applicantReadingCopy(unapproved.client, TOKEN, NOW);
    expect(isIntakeError(result)).toBe(false);
  });

  /**
   * ⚠ **Written twice, because the first version passed on a mutation.** Deleting the
   * `submitted_at` guard entirely left this green: `applicationPreviewPdf` refuses a filed
   * application on its own, and its sentence contains the word "copy" too, so an assertion on the
   * code and on "copy" could not tell the guard from the fallback.
   *
   * What the guard actually buys is that a filed application is refused **without the document
   * being rendered at all** — no draft read, no marks read, no PDF built. That is the property
   * worth having, because re-rendering a §391.51(b)(1) record that already exists in Storage with
   * its own hash is exactly what this route must never do, and "it was thrown away afterwards" is a
   * much weaker promise than "it was never drawn". So the assertion is now about the queries.
   */
  it("refuses a filed application without rendering anything at all", async () => {
    const filed = seed({ invitation: invitation({ submitted_at: "2026-09-18T11:00:00Z" }) });
    const result = await applicantReadingCopy(filed.client, TOKEN, NOW);
    expect(isIntakeError(result)).toBe(true);
    if (!isIntakeError(result)) return;
    expect(result.code).toBe("already_filed");
    // The applicant's own sentence, not the office's. The office is told to open the applicant's
    // page; the applicant has no such page and is told to open their copy.
    expect(result.message).toContain("You have sent this application");
    // ⚠ The discriminating half: the draft was never read, so no packet was ever drawn.
    expect(filed.forTable("application_drafts")).toHaveLength(0);
    expect(filed.forTable("application_packet_marks")).toHaveLength(0);
  });

  it("gives a dead link the one refusal this surface gives every dead link", async () => {
    const result = await applicantReadingCopy(seed({ invitation: null }).client, TOKEN, NOW);
    expect(isIntakeError(result)).toBe(true);
    if (!isIntakeError(result)) return;
    expect(result.code).toBe("invalid_link");
  });

  it("says there is nothing to read rather than drawing an empty packet", async () => {
    const result = await applicantReadingCopy(seed({ payload: null }).client, TOKEN, NOW);
    expect(isIntakeError(result)).toBe(true);
    if (!isIntakeError(result)) return;
    expect(result.code).toBe("nothing_to_read");
  });

  /**
   * ⚠ The service role bypasses RLS, so the scope has to be in every query. Without this, one guessed
   * token would render another carrier's applicant's employment history.
   */
  it("scopes every read to the invitation's own org", async () => {
    const rec = seed({ marks: signedP03 });
    await applicantReadingCopy(rec.client, TOKEN, NOW);
    /**
     * ⚠ `application_invitations` is exempt because it is the CREDENTIAL lookup — the query that
     * resolves a token hash to an org, and therefore the one query that cannot already know one.
     * Every read after it carries the org that lookup returned, which is what the rest of this
     * assertion checks and what keeps a guessed token inside one carrier.
     */
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
    // And that the marks read HAPPENED — an org-scope assertion over a query that was never made
    // passes vacuously, which is this repo's named failure.
    expect(rec.forTable("application_packet_marks").length).toBeGreaterThan(0);
  });

  /**
   * ⚠ The org travels FROM the resolved invitation, never from anywhere else. If a later read ever
   * takes its tenant from another source, this is where it shows: the marks query must ask for the
   * org the token resolved to and no other.
   */
  it("reads the marks for the org the token resolved to, not some other", async () => {
    const rec = seed({ invitation: invitation({ org_id: OTHER_ORG }), marks: signedP03 });
    await applicantReadingCopy(rec.client, TOKEN, NOW);
    const markQueries = rec.forTable("application_packet_marks");
    expect(markQueries.length).toBeGreaterThan(0);
    for (const q of markQueries) {
      expect(q.filters().some((f) => f.col === "org_id" && f.val === OTHER_ORG)).toBe(true);
      expect(q.filters().some((f) => f.col === "org_id" && f.val === ORG)).toBe(false);
    }
  });

  /**
   * ⚠ **The reading copy fetches BOTH pictures, and A2 is why it is pinned here** (Q-HUI14).
   *
   * This document and the FILED packet are the same renderer over the same rows — A2's whole lesson is
   * that two renderings of one document diverge silently and no gate can see it, which is how an
   * office read an eight-page summary for four days while a driver signed a thirty-one-page packet. A
   * reading copy that fetched only the signature would show this driver `p05`, `p06` and `p09` in
   * Helvetica while the packet they are about to sign prints their own hand there — the same failure,
   * one document narrower.
   */
  it("reads both adopted marks, by the slot the contract names for each kind", async () => {
    const rec = seed({ marks: signedP03 });
    await applicantReadingCopy(rec.client, TOKEN, NOW);
    const slots = rec
      .forTable("application_captures")
      .map((q) => q.filters().find((f) => f.col === "slot")?.val);
    expect(slots).toEqual([
      APPLICATION_CAPTURE_MARK_SLOT.signature,
      APPLICATION_CAPTURE_MARK_SLOT.initials,
    ]);
  });

  /**
   * ⚠ The partial case, and it is the one that keeps a public route cheap: with nothing signed there
   * is no line for a picture to sit on, so neither mark is fetched at all. Without this, a version
   * that read both unconditionally would pass the test above and add two Storage reads to every open
   * of an unstarted link.
   */
  it("fetches neither picture on a packet nobody has signed yet", async () => {
    const rec = seed();
    await applicantReadingCopy(rec.client, TOKEN, NOW);
    expect(rec.forTable("application_captures")).toHaveLength(0);
  });
});
