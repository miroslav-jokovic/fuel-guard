import { describe, it, expect, vi, afterEach } from "vitest";
import { APPLICATION_RELEASE_ORDER, DISCLOSURES, ESIGN_CONSENT } from "@fuelguard/shared";
import { loadEnv } from "../env.js";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import {
  hashInvitationToken,
  isIntakeError,
  mintInvitationToken,
  phasesOf,
  recordRelease,
  resolveInvitation,
  sealSsn,
  submitApplication,
} from "./applicationIntake.js";

/**
 * The unauthenticated intake. The token is the ENTIRE access-control story here, so most of what is
 * pinned below is about what a caller holding a bad one learns: nothing, in every case, and always
 * the same nothing.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-08-20T00:00:00Z");
const env = (over: Record<string, string> = {}) => loadEnv({ NODE_ENV: "test", ...over } as NodeJS.ProcessEnv);

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
  it("still resolves after the application has been submitted", async () => {
    const inv = invitation({ submitted_at: "2026-08-19T00:00:00Z" });
    const result = await resolveInvitation(seed(inv).client, TOKEN, NOW);
    expect(isIntakeError(result)).toBe(false);
  });

  it("hands the page the three phase stamps so it opens where the driver stopped", async () => {
    const inv = invitation({
      consented_at: "2026-08-19T00:00:00Z",
      releases_completed_at: "2026-08-19T00:05:00Z",
      submitted_at: null,
    });
    const result = await resolveInvitation(seed(inv).client, TOKEN, NOW);
    if (isIntakeError(result)) throw new Error("expected a live invitation");
    expect(phasesOf(result)).toEqual({
      consentedAt: "2026-08-19T00:00:00Z",
      releasesCompletedAt: "2026-08-19T00:05:00Z",
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
    const rec = seed(invitation({ submitted_at: "2026-08-19T00:00:00Z" }));
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("already_submitted");
    // And nothing reached the transaction — the refusal is before the write, not a rollback.
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a release once the ceremony is complete, without touching the other phases", async () => {
    const rec = seed(invitation({ releases_completed_at: "2026-08-19T00:00:00Z" }));
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("releases_complete");
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
    // A finished ceremony does not stop the application being sent.
    const submitted = await submitApplication(
      seed(invitation({ releases_completed_at: "2026-08-19T00:00:00Z" })).client,
      env(), TOKEN, APPLICATION, CTX, NOW,
    );
    expect(isIntakeError(submitted)).toBe(false);
  });
});

describe("submitting", () => {
  it("hands the transaction the org and driver the TOKEN resolved to, never a client value", async () => {
    const rec = seed();
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
      tables: { application_invitations: [invitation()], organizations: [{ name: "S" }] },
      rpc: { submit_driver_application: { error: { code, message } } },
    });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe(expected);
  });
});

/**
 * D-HIRE6. The last four may be stored; the full value may be sealed and may not be stored any other
 * way. A deployment with no encryption key must not become the deployment that keeps nine digits
 * readable — it keeps four.
 */
describe("the Social Security number", () => {
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
    const rec = seed();
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
  /** Publish counsel's wording for one test. Both gates open on the version string alone. */
  const publish = () => {
    for (const purpose of APPLICATION_RELEASE_ORDER) {
      vi.spyOn(DISCLOSURES[purpose], "version", "get").mockReturnValue("v1");
    }
    vi.spyOn(ESIGN_CONSENT, "version", "get").mockReturnValue("v1");
  };
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

  it("refuses a release on a dead link before it looks at the wording", async () => {
    const result = await recordRelease(
      seed(null).client, TOKEN, { purpose: "psp", signed_name: "S", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("invalid_link");
  });
});
