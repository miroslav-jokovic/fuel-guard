import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  APPLICATION_RELEASE_ORDER,
  DISCLOSURES,
  ESIGN_CONSENT,
  driverPlacementIds,
  packetPlacementById,
} from "@silvicom/shared";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import {
  hashInvitationToken,
  isIntakeError,
  mintInvitationToken,
  phasesOf,
  resolveInvitation,
  sealSsn,
} from "./applicationIntake.js";
// ⚠ ONE suite still, across the A5b split. The submit half moved to its own module and this file did
// not follow it: an untouched suite is what proves the coverage moved WITH the code rather than
// being rewritten around it — the reading #888 relied on when `usePacketCeremony.ts` was split.
import { submitApplication } from "./applicationSubmit.js";
import { recordRelease } from "./applicationReleases.js";
import { PSP_VERSION } from "./defaultWording.js";
import { PSP_MANDATED_INTENT, pspDisclosure } from "./pspDisclosure.js";

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
  /**
   * ⚠ Consented, since D-WORD1 (2026-09-14). The shipped catalogue stopped being draft, so
   * §390.32(d)'s gate is armed on every link and refuses every write before the consent exists —
   * `esign_consent_required` would otherwise be the answer to every test in this file, standing in
   * front of whatever each one was actually about. The gate's own tests override it back to null.
   */
  consented_at: CONSENTED,
  releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z",
  submitted_at: null,
  /** No sign token until the office approves (A5b, 0345) — which is most invitations, most of the time. */
  sign_token_hash: null,
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

/**
 * Every place on the carrier's packet, marked with the name this fixture files under.
 *
 * ⚠ **A submission is refused without these since D-PKT15**, so the default seed carries a packet
 * that IS signed through — the alternative is fifteen existing tests failing for a reason none of
 * them is about. `signedPacket(...)` varies it where a test is about the gate itself.
 *
 * Built from `driverPlacements()` rather than hand-listed: a fixture that named its own stops would
 * keep passing after the inventory changed, which is the one thing this gate must not do.
 *
 * ⚠ **Each row carries the KIND its placement asks for, and the initials are their own string**
 * (Q-PKT8, 0340). `p05`, `p06` and `p09` take initials, which D-PKT6 calls a second adopted mark
 * rather than an abbreviation of the first — so a fixture that put the full name on all twenty-two
 * would agree with a gate that could not tell the two apart.
 */
const signedPacket = (
  name = "Susan Godfrey",
  ids: string[] = driverPlacementIds(),
  initials = "SG",
): Array<{ placement_id: string; mark: string; signed_name: string }> =>
  ids.map((placement_id) => {
    const mark = packetPlacementById(placement_id)?.mark ?? "signature";
    return { placement_id, mark, signed_name: mark === "initials" ? initials : name };
  });

/**
 * AF3/D-AF1: identity recorded, on the row AND in the draft, as `record_applicant_identity` leaves
 * it. `recordRelease` refuses `identity_missing` without both, so every fixture that expects a
 * signature to land carries this.
 */
const IDENTITY_TABLES = {
  drivers: [{ date_of_birth: "1980-04-01", cdl_number: "PA334554", cdl_state: "PA" }],
  application_drafts: [{ payload: { date_of_birth: "1980-04-01", cdl_number: "PA334554", cdl_state: "PA" } }],
};

const seed = (
  inv: Record<string, unknown> | null = invitation(),
  packet = signedPacket(),
  extra: Record<string, unknown> = {},
) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: inv ? [inv] : [],
      organizations: [{ name: "Silvicom" }],
      driver_authorizations: [{ id: "auth-1" }],
      application_packet_marks: packet,
      ...extra,
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

  /**
   * ⚠ Read from the WHOLE recorded query rather than from `filters()`, since A5b. The lookup became an
   * `.or()` so one token can open either door (D-AX15), and `or` is not a method `supabaseRecorder`
   * counts as a filter — so the old assertion went on passing while looking at an empty list, which
   * is a test that cannot fail. The property is about every byte sent to PostgREST, so that is what
   * is inspected.
   */
  it("is never sent to the database in the clear", async () => {
    const rec = seed();
    await resolveInvitation(rec.client, TOKEN, NOW);
    const query = JSON.stringify(rec.forTable("application_invitations")[0]!.ops);
    expect(query).toContain(hashInvitationToken(TOKEN));
    expect(query).not.toContain(TOKEN);
  });
});

/**
 * ⚠ Two doors, one application (A5b, D-AX15).
 *
 * The office's approval email carries a link of its own, minted into `sign_token_hash` beside the
 * invitation's original `token_hash` rather than over it. Both open the same session, and the reason
 * both must is a promise: `APPLY_FLOW_COPY.handoff.waitingNote` tells the applicant to keep the first
 * link because it is where they will sign. A rotation would have been less code and would have made
 * that sentence false at the exact moment somebody acted on it.
 *
 * ⚠ The refusals below each use a token that is NOT either hash, so they keep discriminating: a
 * lookup widened to two columns must not become a lookup that matches anything.
 */
describe("either link opens the same application", () => {
  const SIGN_TOKEN = "s".repeat(43);
  const approved = () => invitation({
    review_requested_at: "2026-08-19T00:00:00Z",
    approved_at: "2026-08-20T00:00:00Z",
    sign_token_hash: hashInvitationToken(SIGN_TOKEN),
  });

  it("opens on the token the applicant was invited with", async () => {
    const rec = createSupabaseRecorder({ tables: { application_invitations: [approved()] } });
    const row = await resolveInvitation(rec.client, TOKEN, NOW);
    expect(isIntakeError(row)).toBe(false);
  });

  it("opens on the sign token the approval email carried", async () => {
    const rec = createSupabaseRecorder({ tables: { application_invitations: [approved()] } });
    const row = await resolveInvitation(rec.client, SIGN_TOKEN, NOW);
    expect(isIntakeError(row)).toBe(false);
    if (isIntakeError(row)) return;
    // The SAME invitation, not a second session: the draft, the phases and the signed releases are all
    // on this row, and a second session would be a second application.
    expect(row.id).toBe("inv-1");
  });

  it("asks PostgREST for both columns, so a sign token can match at all", async () => {
    const rec = createSupabaseRecorder({ tables: { application_invitations: [approved()] } });
    await resolveInvitation(rec.client, SIGN_TOKEN, NOW);
    const ops = rec.forTable("application_invitations")[0]!.ops;
    expect(String(ops.find((o) => o.method === "select")?.args[0])).toContain("sign_token_hash");
    expect(String(ops.find((o) => o.method === "or")?.args[0]))
      .toBe(`token_hash.eq.${hashInvitationToken(SIGN_TOKEN)},sign_token_hash.eq.${hashInvitationToken(SIGN_TOKEN)}`);
  });

  /**
   * ⚠ The widened lookup's own failure mode. `supabaseRecorder` answers with the fixture row whatever
   * was asked, so a row comes back here even though neither hash matches — which is exactly the
   * position production is in when PostgREST's `or` is wrong. The constant-time compare is what
   * refuses, and it is the only thing that does.
   */
  it("refuses a token that matches neither hash, even when a row comes back", async () => {
    const rec = createSupabaseRecorder({ tables: { application_invitations: [approved()] } });
    const row = await resolveInvitation(rec.client, "z".repeat(43), NOW);
    expect(row).toMatchObject({ code: "invalid_link" });
  });

  /** An unapproved invitation has no sign token, and a null must never be treated as a match. */
  it("refuses a sign token against an invitation that has none", async () => {
    const rec = createSupabaseRecorder({ tables: { application_invitations: [invitation()] } });
    expect(await resolveInvitation(rec.client, SIGN_TOKEN, NOW)).toMatchObject({ code: "invalid_link" });
  });

  /**
   * ⚠ And `undefined`, which is a DIFFERENT value and was a real defect for a few minutes: a `!== null`
   * guard let a row with no such property through to the compare. That is what a caller whose query
   * forgot the column hands over, and it must decide nothing. Found by
   * `applicationCopy.test.ts`'s "signs nothing for a token that is not this invitation's", which is
   * why it is pinned here too rather than left to be re-found somewhere else.
   */
  it("refuses when the column was never selected, not only when it is null", async () => {
    const { sign_token_hash: _omitted, ...withoutColumn } = invitation();
    const rec = createSupabaseRecorder({ tables: { application_invitations: [withoutColumn] } });
    expect(await resolveInvitation(rec.client, SIGN_TOKEN, NOW)).toMatchObject({ code: "invalid_link" });
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
      application_sent_at: "2026-08-19T00:10:00Z",
      review_requested_at: "2026-08-19T00:30:00Z",
      approved_at: null,
      submitted_at: null,
    });
    const result = await resolveInvitation(seed(inv).client, TOKEN, NOW);
    if (isIntakeError(result)) throw new Error("expected a live invitation");
    expect(phasesOf(result)).toEqual({
      consentedAt: "2026-08-19T00:00:00Z",
      releasesCompletedAt: "2026-08-19T00:05:00Z",
      applicationSentAt: "2026-08-19T00:10:00Z",
      reviewRequestedAt: "2026-08-19T00:30:00Z",
      approvedAt: null,
      submittedAt: null,
    });
  });

  it("lets a driver sign a release on the link they already submitted through", async () => {
    // ⚠ The point of A1, now shown at full strength. This used to assert the WORDING refusal
    // (Q-H3) because that was as far as the call could get — the endpoint was proved reachable by
    // the error it returned. Since D-WORD1 the same call is what the comment always promised:
    // a recorded signature on a link the applicant has already submitted through.
    const inv = invitation({ submitted_at: "2026-08-19T00:00:00Z" });
    const result = await recordRelease(
      seed(inv, signedPacket(), IDENTITY_TABLES).client, TOKEN,
      { purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result)).toBe(false);
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
      tables: {
        application_invitations: [submittableInvitation()],
        application_packet_marks: signedPacket(),
      },
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
      tables: {
        application_invitations: [submittableInvitation()],
        organizations: [{ name: "S" }],
        application_packet_marks: signedPacket(),
      },
      rpc: { submit_driver_application: { error: { code, message } } },
    });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe(expected);
  });
});

/**
 * ⚠ **The packet has to be signed through before anything is filed (D-PKT15, owner 2026-09-14).**
 *
 * The Send button was held in the UI from the day the walk shipped, and the SERVER would file happily
 * with none of the twenty-two marks — so a packet with blank signature lines was reachable by
 * anything that was not that one screen. These are the floor under it.
 */
describe("the carrier's form has to be signed through", () => {
  it("refuses a submission with no marks at all, and opens no transaction", async () => {
    const rec = seed(invitation({ approved_at: "2026-09-11T09:00:00Z" }), []);
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_not_signed");
    expect(rec.rpcs().filter((r) => r.fn === "submit_driver_application")).toHaveLength(0);
  });

  /**
   * ⚠ One short of the full set, which is the case a count alone would wave through if it were
   * counting rows rather than asking whether every PLACE carries a mark.
   */
  it("refuses a packet missing a single place, and names which kind of refusal it is", async () => {
    const all = driverPlacementIds();
    const rec = seed(invitation({ approved_at: "2026-09-11T09:00:00Z" }), signedPacket("Susan Godfrey", all.slice(0, -1)));
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_not_signed");
  });

  /**
   * ⚠ The right NUMBER of marks, on the wrong places. A count would accept this; the set does not.
   * It is the shape a client bug produces — walking the same stop twice — and the one a row count
   * cannot see.
   */
  it("refuses the right number of marks made on the wrong places", async () => {
    const all = driverPlacementIds();
    const doubled = [...all.slice(0, -1), all[0]!];
    const rec = seed(invitation({ approved_at: "2026-09-11T09:00:00Z" }), signedPacket("Susan Godfrey", doubled));
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_not_signed");
  });

  /**
   * ⚠ **The signature of record is checked, not accepted.** `signed_name` still travels in the
   * payload — it is a contract field on an append-only table — but it is no longer a second thing the
   * driver types, and a payload claiming a name the form was not signed with is refused.
   */
  it("refuses a payload whose signature is not the mark the form was signed with", async () => {
    const rec = seed(invitation({ approved_at: "2026-09-11T09:00:00Z" }), signedPacket("S. Godfrey"));
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_name_mismatch");
    expect(rec.rpcs().filter((r) => r.fn === "submit_driver_application")).toHaveLength(0);
  });

  it("files when every place carries the adopted mark", async () => {
    const rec = seed(invitation({ approved_at: "2026-09-11T09:00:00Z" }));
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
  });

  /**
   * ⚠ AF3/D-AF8: the licence on the filed application is the licence PSP was ordered against. The
   * body is whatever the applicant's tab held, and this tab holds the licence from before the office
   * corrected it — the arrangement that files two different licences for one driver.
   */
  it("files the identity on the driver row, not the one a stale tab sent", async () => {
    const rec = seed(invitation({ approved_at: "2026-09-11T09:00:00Z" }), signedPacket(), {
      drivers: [{ date_of_birth: "1980-04-01", cdl_number: "CORRECTED-1", cdl_state: "IL" }],
    });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    const args = rec.rpcs().find((r) => r.fn === "submit_driver_application")!.args as {
      p_payload: Record<string, unknown>;
      p_driver_patch: Record<string, unknown>;
    };
    expect(args.p_payload).toMatchObject({ cdl_number: "CORRECTED-1", cdl_state: "IL", first_name: "Susan" });
    expect(args.p_driver_patch).toMatchObject({ cdl_number: "CORRECTED-1", cdl_state: "IL" });
  });

  /**
   * ⚠ **The three sets of initials are not the signature, and must not be mistaken for it (Q-PKT8).**
   *
   * This gate compares the payload's `signed_name` against the mark on the paper, and it used to
   * take whichever row came back first. `p05`, `p06` and `p09` carry initials — a second adopted
   * mark, not an abbreviation (D-PKT6) — so the row it landed on decided the answer, and which row
   * that is, is PostgREST's choice rather than ours. The fixture below puts an initials row FIRST,
   * which is the arrangement that refuses a correctly signed packet.
   */
  it("files a packet whose initials differ from the signature, whichever row comes back first", async () => {
    const ids = driverPlacementIds();
    const initialsFirst = [
      ...ids.filter((id) => packetPlacementById(id)?.mark === "initials"),
      ...ids.filter((id) => packetPlacementById(id)?.mark !== "initials"),
    ];
    const packet = signedPacket("Susan Godfrey", initialsFirst, "SG");
    expect(packet[0]!.mark).toBe("initials");
    expect(packet[0]!.signed_name).toBe("SG");

    const rec = seed(invitation({ approved_at: "2026-09-11T09:00:00Z" }), packet);
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
  });

  /**
   * ⚠ The other half of the same filter, so it is not passing because the name check went away. A
   * packet whose SIGNATURE rows disagree with the payload is still refused, however agreeable its
   * initials are.
   */
  it("still refuses a wrong signature even when the initials would have matched", async () => {
    const rec = seed(
      invitation({ approved_at: "2026-09-11T09:00:00Z" }),
      signedPacket("S. Godfrey", driverPlacementIds(), "Susan Godfrey"),
    );
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_name_mismatch");
  });

  it("scopes the packet read to the org the token resolved to", async () => {
    const rec = seed(invitation({ approved_at: "2026-09-11T09:00:00Z" }));
    await submitApplication(rec.client, env(), TOKEN, APPLICATION, CTX, NOW);
    const q = rec.forTable("application_packet_marks")[0]!;
    expect(q.filters()).toContainEqual({ col: "org_id", val: ORG });
    expect(q.filters()).toContainEqual({ col: "invitation_id", val: "inv-1" });
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
        application_packet_marks: signedPacket(),
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
        application_packet_marks: signedPacket(),
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
      tables: {
        ...IDENTITY_TABLES,
        application_invitations: [inv],
        driver_authorizations: [{ id: "auth-1" }],
        // The name FMCSA's "I authorize ___" blanks are filled from.
        organizations: [{ name: "Silvicom" }],
      },
      rpc: { record_driver_release: rpc },
    });

  it("hands the transaction the SERVER's text, version and intent — never the client's", async () => {
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
    // ⚠ FMCSA's own form and its revision date, not our placeholder and not a counter (D-WORD1).
    // `p_text` is what `driver_authorizations.disclosure_text` keeps for ever, so this is the
    // assertion that says a driver signed the federal language rather than an engineer's summary.
    expect(args.p_version).toBe(PSP_VERSION);
    expect(args.p_text).toBe(pspDisclosure("Silvicom").body);
    expect(args.p_text).not.toBe(DISCLOSURES.psp.body);
    expect(args.p_intent).toBe(PSP_MANDATED_INTENT);
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
      tables: { ...IDENTITY_TABLES, application_invitations: [consented()] },
      rpc: { record_driver_release: { error: { code: "DR023", message: "release_already_signed" } } },
    });
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "S", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("release_already_signed");
  });

  it("refuses to sign at all before the electronic-records consent", async () => {
    // ⚠ `consented_at: null` explicitly — the fixture carries a consent by default since D-WORD1,
    // because the gate is live on every link and every other test would otherwise stop here.
    const rec = ceremonyRec(invitation({ consented_at: null }));
    const result = await recordRelease(
      rec.client, TOKEN, { purpose: "psp", signed_name: "S", esign_consent: true }, CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("esign_consent_required");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses once the ceremony is closed, before it reaches the database", async () => {
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

/**
 * ⚠ The wording refusals, kept after D-WORD1 and now reached the only way a real carrier can.
 *
 * The shipped catalogue is never draft, so `disclosure_not_final` and `WORDING_NOT_FINAL` cannot be
 * provoked by doing nothing any more. They CAN still be provoked by a carrier publishing a draft
 * override of their own into `org_disclosures` — which is what these seed. The refusals are the
 * floor under an instrument whose text is not final, and a floor nobody stands on is a floor
 * nobody notices has gone.
 */
describe("signing a release", () => {
  /** A carrier that has overridden the shipped PSP wording with something still marked draft. */
  const draftOverride = (inv = invitation()) =>
    createSupabaseRecorder({
      tables: {
        ...IDENTITY_TABLES,
        application_invitations: [inv],
        organizations: [{ name: "Silvicom" }],
        driver_authorizations: [{ id: "auth-1" }],
        org_disclosures: [{
          instrument: "psp", version: "v0-draft", title: "Draft PSP", body: "Draft body.",
          clauses: null, intent: "Draft intent.",
          published_at: "2026-09-14T09:00:00Z", published_by: null,
        }],
      },
      rpc: { record_driver_release: { authorization_id: "auth-1", signed_count: 1, completed: false } },
    });

  it("refuses while the disclosure is draft wording, and says why", async () => {
    const rec = draftOverride();
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
    // ⚠ And with a DRAFT OVERRIDE, since D-WORD1 — the shipped catalogue is final, so the only
    // carrier who can still reach this refusal is one who published draft text of their own.
    const rec = draftOverride(submittableInvitation());
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
