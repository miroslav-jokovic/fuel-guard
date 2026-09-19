import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { pdfText } from "../../../testing/pdfText.js";
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

const printed = async (rec: ReturnType<typeof seed>, org = ORG): Promise<string> => {
  const result = await applicationPermissionsPdf(rec.client, org, INV);
  expect(isPermissionsError(result)).toBe(false);
  if (isPermissionsError(result)) throw new Error(result.code);
  expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  return pdfText(result.pdf);
};

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
   * ⚠ Half of "what has this applicant signed" is what they have NOT. `APPLICATION_RELEASE_ORDER` has
   * four purposes and this fixture signs two, so a summary that listed only the pages it had would
   * read as complete while two lawful bases were missing.
   */
  it("lists the releases nobody has signed, not only the ones they have", async () => {
    const text = await printed(seed());
    expect(text).toContain("Previous-employer safety performance release");
    expect(text).toContain("Controlled substances and alcohol testing consent");
    expect(text).toContain("Not signed yet");
    // And the two that ARE signed do not say it — otherwise the assertion above passes on a document
    // that says "Not signed yet" against all four.
    expect(text).toContain("wording fcra-2026-08-19");
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
