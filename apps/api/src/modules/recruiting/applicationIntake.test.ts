import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { APPLICATION_RELEASE_ORDER, DISCLOSURES, ESIGN_CONSENT } from "@silvicom/shared";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import {
  hashInvitationToken,
  isIntakeError,
  mintInvitationToken,
  phasesOf,
  resolveInvitation,
  sealSsn,
  submitApplication,
} from "./applicationIntake.js";
import { recordRelease } from "./applicationReleases.js";

/**
 * The unauthenticated intake. The token is the ENTIRE access-control story here, so most of what is
 * pinned below is about what a caller holding a bad one learns: nothing, in every case, and always
 * the same nothing.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-08-20T00:00:00Z");
const env = (over: Record<string, string> = {}) => loadEnv({ NODE_ENV: "test", ...over } as NodeJS.ProcessEnv);

/**
 * Publish counsel's wording for the duration of a test. Every gate in this file opens on the version
 * string alone, so this one helper is the whole of A0 as far as the suite is concerned.
 *
 * ⚠ **It is applied to the SUBMIT suites too, since 2026-08-23.** `submitApplication` now refuses
 * while any instrument is draft (`WORDING_NOT_FINAL`), and the submit tests describe the world where
 * submission is lawful — so they say so out loud rather than passing because the gate did not exist.
 * The two tests that pin the refusal itself deliberately do not call this.
 */
const publish = (): void => {
  for (const purpose of APPLICATION_RELEASE_ORDER) {
    vi.spyOn(DISCLOSURES[purpose], "version", "get").mockReturnValue("v1");
  }
  vi.spyOn(ESIGN_CONSENT, "version", "get").mockReturnValue("v1");
};

const TOKEN = "a".repeat(43);
const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  org_id: ORG,
  driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2026-09-01T00:00:00Z",
  revoked_at: null,
  consented_at: null,
  releases_completed_at: null,
  submitted_at: null,
  ...over,
});

/**
 * A link in the state a lawful submission is actually made from.
 *
 * ⚠ **It has grown twice, and each time because a gate that had been inert became real.**
 *
 * 2026-08-23 added the CONSENT. While `ESIGN_CONSENT` was draft `esignConsentRequired()` returned
 * false, so a submission needed no consent stamp and these fixtures carried none; publishing the
 * wording turns the requirement on, and the fixture now says out loud what the submission rests on.
 *
 * 2026-09-11 added the REVIEW and the APPROVAL (F4). The office reads the application before anybody
 * certifies it, so an unapproved link can no longer file one — and a fixture without those two stamps
 * would describe a world that has not existed since. The tests that pin the refusal itself
 * deliberately build their own invitation without them.
 */
const CONSENTED = "2026-08-21T09:00:00Z";
const submittableInvitation = (over: Record<string, unknown> = {}) =>
  invitation({
    consented_at: CONSENTED,
    review_requested_at: "2026-08-21T09:20:00Z",
    approved_at: "2026-08-21T10:00:00Z",
    ...over,
  });

const seed = (inv: Record<string, unknown> | null = invitation()) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: inv ? [inv] : [],
      organizations: [{ name: "Silvicom" }],
      driver_authorizations: [{ id: "auth-1" }],
    },
    rpc: { submit_driver_application: { application_id: "app-1" } },
  });

const APPLICATION = {
  application: {
    first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
    email: "s@example.test", phone: "555-0111", addresses: [],
    cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
    // §391.21(b)(6) is mandatory content of the application form; a fixture standing in for a
    // certified document answers at least one half of it.
    experience: "Eight years, dry van and reefer.",
    accidents: [], declares_no_accidents: true,
    violations: [], declares_no_violations: true,
    licence_ever_denied: false,
    employers: [], declares_no_employment: true,
    certified: true as const, signed_name: "Susan Godfrey",
  },
  ssn: null,
} as unknown as Parameters<typeof submitApplication>[3];

const CTX = { ip: "203.0.113.9", userAgent: "Mozilla/5.0" };

describe("the token", () => {
  it("is 256 bits and stored only as a hash", () => {
    const { token, hash } = mintInvitationToken();
    // 32 random bytes, base64url — no padding, 43 characters.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(mintInvitationToken().token).not.toBe(token);
  });

  it("is never sent to the database in the clear", async () => {
    const rec = seed();
    await resolveInvitation(rec.client, TOKEN, NOW);
    const filters = JSON.stringify(rec.forTable("application_invitations")[0]!.filters());
    expect(filters).toContain(hashInvitationToken(TOKEN));
    expect(filters).not.toContain(TOKEN);
  });
});

/**
 * Expired, revoked, never existed — one refusal, one message. Telling them apart would let an
 * anonymous caller learn that a token EXISTED, which is a fact about a person applying for a job.
 * (A spent PHASE is no longer one of these — see "the link is a session" below.)
 */
describe("every bad link fails the same way", () => {
  const cases: Array<[string, Record<string, unknown> | null]> = [
    ["no such invitation", null],
    ["revoked", invitation({ revoked_at: "2026-08-19T00:00:00Z" })],
    ["expired", invitation({ expires_at: "2026-08-01T00:00:00Z" })],
  ];

  it.each(cases)("refuses %s with the same code and message", async (_label, inv) => {
    const result = await resolveInvitation(seed(inv).client, TOKEN, NOW);
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
    expect(isIntakeError(result) && result.message).toBe(
      "This application link is not valid. Ask for a new one.",
    );
  });

  it("files nothing when the link is dead", async () => {
    const rec = seed(null);
    await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(rec.rpcs()).toHaveLength(0);
  });
});

/**
 * A1, and the defect it exists to fix (APPLICATION-SYSTEM-PLAN §0.2).
 *
 * Before 0225 a submitted application killed the token, and `POST /:token/release` resolves through
 * the same function — so the per-instrument signing the applicant's page promises was unreachable
 * through the link that promised it. The link is a session now: revocation and expiry kill all of
 * it, and a spent phase is refused only by the path that spends it.
 */
describe("the link is a session, not a fuse", () => {
  // ⚠ NOT published for the whole describe: two of these pin the draft refusal itself, and the one
  // submission below publishes for itself.
  afterEach(() => vi.restoreAllMocks());

  it("still resolves after the application has been submitted", async () => {
    const inv = invitation({ submitted_at: "2026-08-19T00:00:00Z" });
    const result = await resolveInvitation(seed(inv).client, TOKEN, NOW);
    expect(isIntakeError(result)).toBe(false);
  });

  it("hands the page every phase stamp so it opens where the driver stopped", async () => {
    // ⚠ Five since F4, not three. The two the OFFICE owns are here because the applicant's page
    // cannot otherwise tell apart three states that look identical to it — still filling it in,
    // waiting for the carrier, and asked to sign — and the only thing separating them is a stamp.
    const inv = invitation({
      consented_at: "2026-08-19T00:00:00Z",
      releases_completed_at: "2026-08-19T00:05:00Z",
      review_requested_at: "2026-08-19T00:30:00Z",
      approved_at: null,
      submitted_at: null,
    });
    const result = await resolveInvitation(seed(inv).client, TOKEN, NOW);
    if (isIntakeError(result)) throw new Error("expected a live invitation");
    expect(phasesOf(result)).toEqual({
      consentedAt: "2026-08-19T00:00:00Z",
      releasesCompletedAt: "2026-08-19T00:05:00Z",
      reviewRequestedAt: "2026-08-19T00:30:00Z",
      approvedAt: null,
      submittedAt: null,
    });
  });

  it("lets a driver sign a release on the link they already submitted through", async () => {
    // The point of A1: this reaches the WORDING gate (Q-H3) instead of a dead-link refusal. When A0
    // publishes the v1 text this same call records a signature.
    const inv = invitation({ submitted_at: "2026-08-19T00:00:00Z" });
    const result = await recordRelease(
      seed(inv).client, TOKEN, { purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("disclosure_not_final");
  });

  it("refuses a second submission, and says so rather than pretending the link is broken", async () => {
    // Published, so the answer is about the SPENT PHASE and not about the wording — the phase
    // refusals come first and this asserts that they still do.
    publish();
    const rec = seed(submittableInvitation({ submitted_at: "2026-08-19T00:00:00Z" }));
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("already_submitted");
    // And nothing reached the transaction — the refusal is before the write, not a rollback.
    expect(rec.rpcs()).toHaveLength(0);
  });

  /**
   * ⚠ The certification cannot be given before the office has approved the document (F4, D-AX11).
   *
   * §391.21(b)(12) has the applicant swear that every entry is true and complete, and the office can
   * now change an entry between the driver sending the application and the driver signing it. A
   * signature taken before the review is a signature on a document that may not be the one filed —
   * and `submitted_at` spends the phase, so that file could never afterwards be corrected.
   */
  it("refuses a certification on an application nobody has approved", async () => {
    publish();
    const rec = seed(invitation({ consented_at: CONSENTED }));
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("not_yet_approved");
    // Nothing reached the transaction: the refusal is before the write, not a rollback.
    expect(rec.rpcs()).toHaveLength(0);
    expect(rec.writtenRows("driver_applications")).toHaveLength(0);
  });

  it("refuses one the office is still reading", async () => {
    // Handed over, not yet approved — the state a driver is in for most of the days this takes.
    publish();
    const rec = seed(invitation({ consented_at: CONSENTED, review_requested_at: "2026-08-21T09:20:00Z" }));
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("not_yet_approved");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("and says what to do about it, rather than that the link is broken", async () => {
    publish();
    const result = await submitApplication(
      seed(invitation({ consented_at: CONSENTED })).client, env(), TOKEN, APPLICATION, CTX, NOW,
    );
    if (!isIntakeError(result)) throw new Error("expected a refusal");
    expect(result.message).toContain("reopen your link");
    // Never `invalid_link`: the link is perfectly good, and sending them back to the recruiter for a
    // replacement would fix nothing.
    expect(result.code).not.toBe("invalid_link");
  });

  it("refuses a release once the ceremony is complete, without touching the other phases", async () => {
    const rec = seed(invitation({ releases_completed_at: "2026-08-19T00:00:00Z" }));
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("releases_complete");
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
    // A finished ceremony does not stop the application being sent. Published and consented, because
    // that is the only world in which a submission is lawful at all since 2026-08-23.
    publish();
    const submitted = await submitApplication(
      seed(submittableInvitation({ releases_completed_at: "2026-08-19T00:00:00Z" })).client,
      env(), TOKEN, APPLICATION, CTX, NOW,
    );
    expect(isIntakeError(submitted)).toBe(false);
  });
});

/**
 * A6/D-APP9 at the boundary that matters. The PDF is a derivative of evidence that is already
 * committed and append-only; failing a driver's submission over a rendering problem would trade the
 * irreplaceable for the regenerable.
 */
describe("the rendered document never costs the submission", () => {
  beforeEach(publish);
  afterEach(() => vi.restoreAllMocks());

  it("still files the application when the renderer throws", async () => {
    const rec = seed(submittableInvitation());
    // No `organizations` fixture and no storage behind it: the render path will fail somewhere.
    const broken = createSupabaseRecorder({
      tables: { application_invitations: [submittableInvitation()] },
      rpc: {
        submit_driver_application: { application_id: "app-1" },
        // The RPC the filing path finishes with — made to fail, so the whole tail is unhappy.
        attach_application_document: { error: { code: "XX000", message: "boom" } },
      },
    });
    void rec;
    const result = await submitApplication(broken.client, env(), TOKEN, APPLICATION, CTX, NOW);
    // The submission stands. That is the entire assertion.
    expect(isIntakeError(result)).toBe(false);
    expect(isIntakeError(result) ? null : result.applicationId).toBe("app-1");
  });
});

describe("submitting", () => {
  beforeEach(publish);
  afterEach(() => vi.restoreAllMocks());

  it("hands the transaction the org and driver the TOKEN resolved to, never a client value", async () => {
    const rec = seed(submittableInvitation());
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect(args.p_org).toBe(ORG);
    expect(args.p_driver).toBe(DRIVER);
    expect(args.p_invitation).toBe("inv-1");
    // ESIGN attribution evidence, the same three facts 0215 records for a staff-recorded signature.
    expect(args.p_ip).toBe("203.0.113.9");
    expect(args.p_user_agent).toBe("Mozilla/5.0");
  });

  /** The FOR UPDATE lock's two verdicts, each turned into the answer that fits it. */
  it.each([
    ["DA021", "application_invitation_unusable", "invalid_link"],
    ["DA022", "application_already_submitted", "already_submitted"],
  ])("turns the transaction's %s into %s", async (code, message, expected) => {
    const rec = createSupabaseRecorder({
      tables: { application_invitations: [submittableInvitation()], organizations: [{ name: "S" }] },
      rpc: { submit_driver_application: { error: { code, message } } },
    });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe(expected);
  });
});

/**
 * A8/D-APP10 — where the staged photographs join the certified application.
 *
 * The two assertions are the two halves of one decision. The array reaches the transaction, so the
 * documents and the application are filed together or not at all; and the parameter is OMITTED when
 * there is nothing to file, which is what lets an eleven-argument call keep resolving against a
 * function 0230 has not yet widened. That is not tidiness — it is the deploy-then-migrate race
 * 0229's header describes, taken from the side the API can control.
 */
describe("the photographs the application arrives with", () => {
  beforeEach(publish);
  afterEach(() => vi.restoreAllMocks());

  const CAPTURE = "aaaaaaaa-1111-4111-8111-111111111111";

  const withCaptures = () =>
    createSupabaseRecorder({
      tables: {
        application_invitations: [submittableInvitation()],
        organizations: [{ name: "Silvicom" }],
        application_captures: [{
          id: CAPTURE, slot: "medical_card",
          storage_path: `${ORG}/inv-1/${CAPTURE}.webp`, content_type: "image/webp",
          bytes: 1024, sha256: "a1".repeat(32), captured_at: "2026-08-20T00:00:00Z",
        }],
      },
      rpc: { submit_driver_application: { application_id: "app-1" } },
      storage: { copy: () => ({ data: { path: "x" }, error: null }) },
    });

  it("copies the bytes into the evidence bucket BEFORE the transaction opens", async () => {
    const rec = withCaptures();
    await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    // Copy first, file second: the reverse order can leave `documents` citing evidence that is not
    // there, which is the one state 0146's design exists to prevent.
    expect(rec.storageCalls().find((c) => c.fn === "copy")).toBeTruthy();
    const args = rec.rpcs().find((r) => r.fn === "submit_driver_application")!.args as Record<string, unknown>;
    expect(args.p_captures).toEqual([
      { capture_id: CAPTURE, kind: "medical_card", page: 1, storage_path: `${ORG}/driver/${DRIVER}/${CAPTURE}.webp` },
    ]);
  });

  it("omits the parameter entirely when nothing was staged", async () => {
    const rec = seed(submittableInvitation());
    await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect("p_captures" in args).toBe(false);
  });

  it("refuses the submission rather than filing an application without its photographs", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        application_invitations: [submittableInvitation()],
        application_captures: [{
          id: CAPTURE, slot: "cdl_front",
          storage_path: `${ORG}/inv-1/${CAPTURE}.webp`, content_type: "image/webp",
          bytes: 1024, sha256: "a1".repeat(32), captured_at: "2026-08-20T00:00:00Z",
        }],
      },
      rpc: { submit_driver_application: { application_id: "app-1" } },
      storage: {
        copy: () => ({ data: null, error: { message: "storage is down" } }),
        list: () => ({ data: [], error: null }),
      },
    });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("capture_promotion_failed");
    // And nothing was spent: the phase stamp is inside the transaction that never ran, so pressing
    // send again promotes the same set.
    expect(rec.rpcs().some((r) => r.fn === "submit_driver_application")).toBe(false);
  });
});

/**
 * D-HIRE6. The last four may be stored; the full value may be sealed and may not be stored any other
 * way. A deployment with no encryption key must not become the deployment that keeps nine digits
 * readable — it keeps four.
 */
describe("the Social Security number", () => {
  beforeEach(publish);
  afterEach(() => vi.restoreAllMocks());

  it("seals the full value and keeps the last four", () => {
    const configured = env({ SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });
    const { last4, sealed } = sealSsn(configured, ORG, "123456789");
    expect(last4).toBe("6789");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("123456789");
  });

  it("drops the full value rather than storing it in the clear when sealing is unavailable", () => {
    const { last4, sealed } = sealSsn(env(), ORG, "123456789");
    expect(last4).toBe("6789");
    expect(sealed).toBeNull();
  });

  it("stores nothing at all when the applicant gave nothing", () => {
    expect(sealSsn(env(), ORG, null)).toEqual({ last4: null, sealed: null });
  });

  it("never sends the number to the transaction", async () => {
    const rec = seed(submittableInvitation());
    await submitApplication(rec.client, env(), TOKEN, { ...APPLICATION, ssn: "123456789" }, CTX, NOW);
    expect(JSON.stringify(rec.rpcs()[0]!.args)).not.toContain("123456789");
  });
});

/**
 * The gate that keeps a real signature off placeholder wording (Q-H3). Tied to the version string,
 * so it opens by itself when counsel's text lands rather than waiting for somebody to clear a flag.
 */
/**
 * A5, the ceremony — proved against a stubbed NON-DRAFT `DISCLOSURES`, which is what lets this ship
 * before A0. The four instruments become four rows, each carrying its own text and its own version,
 * and the fourth closes the phase.
 */
describe("the signing ceremony", () => {
  afterEach(() => vi.restoreAllMocks());

  const consented = () => invitation({ consented_at: "2026-08-21T09:00:00Z" });

  const ceremonyRec = (inv = consented(), rpc: Record<string, unknown> = { authorization_id: "auth-1", signed_count: 1, completed: false }) =>
    createSupabaseRecorder({
      tables: { application_invitations: [inv], driver_authorizations: [{ id: "auth-1" }] },
      rpc: { record_driver_release: rpc },
    });

  it("hands the transaction the SERVER's text, version and intent — never the client's", async () => {
    publish();
    const rec = ceremonyRec();
    const result = await recordRelease(
      rec.client, TOKEN,
      // A client trying to author its own disclosure has nowhere to put one: the body carries the
      // purpose, the name and the affirmation, and that is the whole schema.
      { purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result)).toBe(false);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect(args.p_purpose).toBe("psp");
    expect(args.p_version).toBe("v1");
    expect(args.p_text).toBe(DISCLOSURES.psp.body);
    expect(args.p_intent).toBe(DISCLOSURES.psp.intent);
    expect(args.p_signed_name).toBe("Susan Godfrey");
    // The count comes from the shared vocabulary, so a fifth instrument is one array entry.
    expect(args.p_expected_count).toBe(APPLICATION_RELEASE_ORDER.length);
    // ESIGN attribution, the same three facts every signature here carries.
    expect(args.p_ip).toBe("203.0.113.9");
    expect(args.p_user_agent).toBe("Mozilla/5.0");
  });

  it("reports the ceremony closing on the last instrument", async () => {
    publish();
    const rec = ceremonyRec(consented(), { authorization_id: "auth-4", signed_count: 4, completed: true });
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "drug_alcohol", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) ? null : result.completed).toBe(true);
    expect(isIntakeError(result) ? null : result.signedCount).toBe(4);
  });

  it("turns a double-tap into the answer the page can act on", async () => {
    publish();
    const rec = createSupabaseRecorder({
      tables: { application_invitations: [consented()] },
      rpc: { record_driver_release: { error: { code: "DR023", message: "release_already_signed" } } },
    });
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "S", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("release_already_signed");
  });

  it("refuses to sign at all before the electronic-records consent", async () => {
    publish();
    // No `consented_at`: §390.32(d) is not satisfied, so there is nothing to sign electronically yet.
    const rec = ceremonyRec(invitation());
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "S", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("esign_consent_required");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses once the ceremony is closed, before it reaches the database", async () => {
    publish();
    const rec = ceremonyRec(invitation({
      consented_at: "2026-08-21T09:00:00Z",
      releases_completed_at: "2026-08-21T09:05:00Z",
    }));
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "S", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("releases_complete");
    expect(rec.rpcs()).toHaveLength(0);
  });
});

describe("signing a release", () => {
  it("refuses while the disclosure is draft wording, and says why", async () => {
    const rec = seed();
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("disclosure_not_final");
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
  });

  /**
   * ⚠ The §390.32(d) window, closed 2026-08-23.
   *
   * Signing was blocked and certifying was not, so the one document the link exists to produce could
   * be filed with no 7001(c) consent behind it and no authorization signed — and submitting spends
   * the phase, so that file could never afterwards acquire either.
   */
  it("refuses the SUBMISSION too while the wording is draft, before anything is written", async () => {
    // ⚠ From an APPROVED link since F4, or the answer would be about the phase instead: the phase
    // refusals come first by design (they are about this link and are cheap), so a fixture that had
    // not been approved would pin the wrong gate and this test would stop being about the wording.
    const rec = seed(submittableInvitation());
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("disclosure_not_final");
    expect(rec.rpcs()).toHaveLength(0);
    expect(rec.writtenRows("driver_applications")).toHaveLength(0);
  });

  it("files the application the moment the wording is published, with nothing else changed", async () => {
    publish();
    const rec = seed(submittableInvitation());
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    vi.restoreAllMocks();
  });

  it("refuses a release on a dead link before it looks at the wording", async () => {
    const result = await recordRelease(
      seed(null).client, TOKEN, { purpose: "psp", signed_name: "S", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
  });
});
