import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashInvitationToken } from "../applicationIntake.js";
import {
  APPLICATION_RELEASE_ORDER,
  AUTHORIZATION_PURPOSES,
  DISCLOSURES,
  ESIGN_CONSENT,
  esignConsentBody,
  driverPlacementIds,
  packetPlacementById,
} from "@silvicom/shared";
import { packetWording } from "../packetWording.js";
import { PSP_DISCLOSURE_TITLE, PSP_MANDATED_INTENT, missingPspParagraphs, pspDisclosure } from "../pspDisclosure.js";
import { CLEARINGHOUSE_VERSION, ESIGN_VERSION } from "../defaultWording.js";

/**
 * The public surface, end to end and unauthenticated.
 *
 * Two properties are pinned that nothing else can pin: this path takes NO bearer token and still
 * writes, and it leaks nothing about who exists. Every dead link answers 404 with one code, and a
 * successful submission hands back an application id and not the org or driver it resolved to.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

/**
 * ⚠ **A carrier whose wording is still draft — a state the product no longer ships (D-WORD1).**
 *
 * `defaultWording()` resolves every instrument to FMCSA's forms, the statute or the carrier's own
 * packet, none of which is `v0-draft`, so `disclosure_not_final` and `WORDING_NOT_FINAL` became
 * unreachable through the shipped catalogue on 2026-09-14.
 *
 * They are NOT dead code and the tests below are not obsolete. The fallback is still there for the
 * one branch that can reach it — an instrument whose source module returns nothing — and it is the
 * branch that fails CLOSED, which is the only acceptable direction for a function deciding whether
 * a signature may be taken. Mocking is the only way to stand in that state now, so the mock is
 * narrow and opt-in: flip `draftWording.on` for the tests that are about the refusal, and leave it
 * alone everywhere else.
 */
const draftWording = vi.hoisted(() => ({ on: false }));
vi.mock("../defaultWording.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../defaultWording.js")>();
  const shared = await import("@silvicom/shared");
  return {
    ...real,
    defaultWording: (name: string) =>
      draftWording.on
        ? { disclosures: shared.DISCLOSURES, esignConsent: shared.ESIGN_CONSENT }
        : real.defaultWording(name),
  };
});
/** Opt in for one describe, and always back off — a leak would open every gate after it. */
const withDraftWording = (): void => {
  beforeEach(() => { draftWording.on = true; });
  afterEach(() => { draftWording.on = false; });
};

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const TOKEN = "b".repeat(43);

let server: Server;
let baseUrl: string;

/**
 * One request, from its own address.
 *
 * ⚠ This surface is rate limited to 20 requests a minute per IP (`app.ts:147`), stacked with
 * `/api/public`'s 60 — the intersection A2's autosave budget is built on. Every test in this file
 * shares one Express instance, so without a distinct `X-Forwarded-For` the twenty-first assertion in
 * the file starts failing with 429 and the failure looks like whatever that test was about. `trust
 * proxy` is set in `app.ts`, so this is also what makes `req.ip` the applicant's address in
 * production. The limiter itself is pinned by its own test below rather than by accident.
 */
let callSeq = 0;
const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/public/application${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${(callSeq++ % 250) + 1}`,
      ...(init.headers ?? {}),
    },
  });

/** The same address every time — for the one test that is about the limiter. */
const callFromOneAddress = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/public/application${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7", ...(init.headers ?? {}) },
  });

/**
 * Counsel's wording, published for one test — every instrument the applicant's path touches.
 *
 * ⚠ Distinct from the `publish` further down, which mocks only `ESIGN_CONSENT` because that is all
 * the consent endpoint reads. Submitting reads all five (`applicationWordingIsDraft()`), so a test
 * that publishes half of them is testing the refusal it meant to bypass.
 *
 * ⚠⚠ And BOTH of them publish by mocking a module constant, which is a route production cannot
 * take. Since 0338 a carrier publishes ROWS into `org_disclosures` and the constants stay
 * `v0-draft` for ever, so a function reading the constant is a function that never notices. That
 * substitution hid a live §390.32(d) hole for the whole of A4's lifetime — see "with the carrier's
 * wording published as rows" at the end of this file, which seeds the table instead.
 */
const publishAll = (): void => {
  for (const purpose of APPLICATION_RELEASE_ORDER) {
    vi.spyOn(DISCLOSURES[purpose], "version", "get").mockReturnValue("v1");
  }
  vi.spyOn(ESIGN_CONSENT, "version", "get").mockReturnValue("v1");
};

/**
 * A packet signed through, as the database holds one.
 *
 * ⚠ **Every row carries its placement's `mark`, and the three that take initials carry initials**
 * (Q-PKT8, 0340). `packetIsSignedThrough` reads the first `signature` row to find the name the form
 * was signed with; a fixture that omitted the column looked to it like a packet with no signature on
 * it at all, and a fixture that put the full name on `p05` would agree with a gate that could not
 * tell D-PKT6's two adopted marks apart.
 */
const signedPacket = (name = "Susan Godfrey", initials = "SG") =>
  driverPlacementIds(null).map((placement_id) => {
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

const seed = (over: Record<string, unknown> | null = {}, extra: Record<string, unknown> = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over
        ? [{
            id: "inv-1", org_id: ORG, driver_id: DRIVER,
            token_hash: hashInvitationToken(TOKEN),
            expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
            /**
             * ⚠ Consented, since D-WORD1 (2026-09-14). The shipped catalogue is no longer draft, so
             * `esignConsentRequired` is armed on every link and §390.32(d)'s gate refuses every
             * write path before the consent exists. A fixture with `consented_at: null` is now a
             * fixture of a driver who has not started, not of an ordinary one — the consent is the
             * first act on the link. The tests that are ABOUT the gate override it back to null.
             */
            consented_at: "2026-09-14T08:00:00Z", releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z", submitted_at: null,
            // F4: submitting requires an approved application, so the default link is one the office
            // has read and approved — and, since AF5 (D-AF3), opened for signing in the office, which
            // the packet's marks need before anything can be filed. A phase test overrides these.
            review_requested_at: "2026-09-10T09:00:00Z", approved_at: "2026-09-11T09:00:00Z",
            signing_opened_at: "2026-09-12T09:00:00Z",
            ...over,
          }]
        : [],
      organizations: [{ name: "Silvicom Inc" }],
      driver_authorizations: [{ id: "auth-1" }],
      application_drafts: [],
      /**
       * ⚠ Signed through, since D-PKT15 (2026-09-14). Submitting now requires a mark at every one of
       * the twenty-two places on the carrier's form and a payload whose `signed_name` is the mark
       * they were signed with — so the default link is one whose packet is complete, the way it is
       * already one the office has approved. A test ABOUT that gate overrides this.
       */
      application_packet_marks: signedPacket(),
      // Last, so a fixture's own `drivers`/`application_drafts` win over the defaults above.
      ...extra,
    },
    rpc: {
      submit_driver_application: { application_id: "app-1" },
      save_application_draft: { draft_id: "d-1", updated_at: "2026-08-21T09:05:00Z" },
      record_esign_consent: { consent_id: "c-1" },
    },
  });

/** The same seed, with a saved draft behind the link. */
const seedWithDraft = (payload: Record<string, unknown>): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: "inv-1", org_id: ORG, driver_id: DRIVER,
        token_hash: hashInvitationToken(TOKEN),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
        consented_at: "2026-09-14T08:00:00Z", releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z", submitted_at: null,
      }],
      organizations: [{ name: "Silvicom Inc" }],
      application_drafts: [{ payload, furthest_section: "identity", updated_at: "2026-08-21T09:00:00Z" }],
    },
    rpc: { save_application_draft: { draft_id: "d-1", updated_at: "2026-08-21T09:05:00Z" } },
  });

const APPLICATION = {
  application: {
    first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
    email: "s@example.test", phone: "5550111", addresses: [{ line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: null }],
    cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
    // §391.21(b)(6) is mandatory content of the application form; a fixture standing in for a
    // certified document answers at least one half of it.
    experience: "Eight years, dry van and reefer.",
    accidents: [], declares_no_accidents: true,
    violations: [], declares_no_violations: true,
    licence_ever_denied: false,
    employers: [], declares_no_employment: true,
    certified: true, signed_name: "Susan Godfrey",
  },
  ssn: null,
};

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("opening the link", () => {
  it("needs no bearer token and names the carrier", async () => {
    holder.client = seed().client;
    const res = await call(`/${TOKEN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { carrier: string; releases: Array<{ purpose: string; body: string; draft: boolean }> };
    expect(body.carrier).toBe("Silvicom Inc");
    // ⚠ Since D-WORD1 none of them is draft on a fresh carrier: they are FMCSA's PSP form, the
    // carrier's own packet pages and FMCSA's Clearinghouse sample, and the applicant can sign on the
    // day the product deploys.
    expect(body.releases.map((r) => r.draft)).toEqual([false, false, false, false, false]);
    // The wording is SERVED, so what somebody signed is a fact the server can prove — never shipped
    // in the client bundle where a build could change it.
    expect(body.releases.map((r) => r.purpose)).toEqual([
      "fcra_disclosure", "psp", "previous_employer", "drug_alcohol", "clearinghouse",
    ]);
    expect(body.releases.every((r) => r.body.length > 0)).toBe(true);
    // ⚠ Q-H3 was "every instrument still ships as draft, and the applicant's page is told so".
    // D-WORD1 answered it: they ship sourced and final. The PSP one is FMCSA's own form, which is
    // the sharpest check that the served text is not our placeholder.
    expect(body.releases.find((r) => r.purpose === "psp")!.body)
      .toContain("Federal Motor Carrier Safety Administration (FMCSA)");
  });

  it("hands back the phase stamps, and nothing else about the session", async () => {
    holder.client = seed({ consented_at: "2026-08-20T09:00:00Z" }).client;
    const res = await call(`/${TOKEN}`);
    const body = (await res.json()) as { phases: Record<string, string | null> };
    expect(body.phases).toEqual({
      consentedAt: "2026-08-20T09:00:00Z",
      releasesCompletedAt: null,
      // The two the office owns (F4) — set here because `seed()`'s default link is one that has been
      // read and approved, which is the only state a submission is made from.
      reviewRequestedAt: "2026-09-10T09:00:00Z",
      approvedAt: "2026-09-11T09:00:00Z",
      submittedAt: null,
      // AF4: the office's third act, and the one the page's "we have your permissions" screen reads.
      applicationSentAt: "2026-09-14T09:00:00Z",
      // AF5: the office's fourth, and the one the page's "you sign it in their office" screen reads.
      signingOpenedAt: "2026-09-12T09:00:00Z",
    });
  });

  it("hands back what the office corrected, without naming who corrected it", async () => {
    // ⚠ D-AX12: the driver is about to certify that every entry is true, so they are owed the
    // changes somebody else made to their statement. Who typed it is the carrier's own record.
    holder.client = createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: null, releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z",
          review_requested_at: "2026-09-10T09:00:00Z", approved_at: "2026-09-11T09:00:00Z",
          submitted_at: null,
        }],
        organizations: [{ name: "Silvicom Inc" }],
        application_edits: [{
          path: ["employers", 0, "city"], before: "Jolliet", after: "Joliet",
          edited_at: "2026-09-11T08:00:00Z", edited_by: "cccccccc-dddd-4eee-8fff-000000000000",
        }],
      },
    }).client;

    const res = await call(`/${TOKEN}`);
    const body = (await res.json()) as { edits: Array<Record<string, unknown>> };
    expect(body.edits).toHaveLength(1);
    expect(body.edits[0]).toEqual({
      path: ["employers", 0, "city"], before: "Jolliet", after: "Joliet",
      editedAt: "2026-09-11T08:00:00Z",
    });
    expect(JSON.stringify(body.edits)).not.toContain("cccccccc");
  });

  it("tells an anonymous caller nothing about who exists", async () => {
    holder.client = seed(null).client;
    const res = await call(`/${TOKEN}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_link");
    expect(JSON.stringify(body)).not.toContain(ORG);
    expect(JSON.stringify(body)).not.toContain(DRIVER);
  });
});

/**
 * The only thing standing between a leaked link and an automated replay, and the budget every
 * autosave in A2 is sized against. Worth one test that it is actually mounted.
 */
describe("the rate limit", () => {
  it("cuts off a caller hammering one link", async () => {
    holder.client = seed().client;
    let sawLimit = false;
    for (let i = 0; i < 25 && !sawLimit; i++) {
      const res = await callFromOneAddress(`/${TOKEN}`);
      if (res.status === 429) sawLimit = true;
    }
    expect(sawLimit).toBe(true);
  });
});

/**
 * Handing the finished application to the office (F4, D-AX11).
 *
 * The act is the whole payload: the answers are already saved, and a body here would be a second copy
 * of the application arriving by a different road.
 */
describe("sending it to the carrier to read", () => {
  it("stamps the hand-off and says when", async () => {
    holder.client = createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: null, releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z",
          review_requested_at: null, approved_at: null, submitted_at: null,
        }],
        application_drafts: [{ invitation_id: "inv-1" }],
        audit_logs: [],
      },
    }).client;

    const res = await call(`/${TOKEN}/review`, { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; reviewRequestedAt: string };
    expect(body.ok).toBe(true);
    expect(typeof body.reviewRequestedAt).toBe("string");
    // Nothing about who it resolved to, like every other answer on this surface.
    expect(JSON.stringify(body)).not.toContain(ORG);
    expect(JSON.stringify(body)).not.toContain(DRIVER);
  });

  it("answers 409 when there is nothing saved to read, not 500", async () => {
    // A link nobody has handed over yet — `seed()`'s default is one the office has already approved.
    holder.client = seed({ review_requested_at: null, approved_at: null }).client;
    const res = await call(`/${TOKEN}/review`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("nothing_to_review");
  });

  it("answers a dead link the way every dead link is answered", async () => {
    holder.client = seed(null).client;
    const res = await call(`/${TOKEN}/review`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_link");
  });
});

describe("submitting", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a certified application without any credential", async () => {
    // ⚠ No `publishAll()` any more — the shipped catalogue is already final (D-WORD1), which is
    // the whole change: a carrier that has done nothing at all can take a signed application.
    const rec = seed({ consented_at: "2026-08-21T09:00:00Z" });
    holder.client = rec.client;
    const res = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { applicationId: string };
    expect(body.applicationId).toBe("app-1");
    // The applicant is handed their application id and nothing else — not their driver id, not the
    // carrier's org id.
    expect(JSON.stringify(body)).not.toContain(DRIVER);
    expect(JSON.stringify(body)).not.toContain(ORG);
  });

  /**
   * ⚠ The §390.32(d) window at the edge of the API (2026-08-23), kept after D-WORD1.
   *
   * 409, not 500: the link is perfectly good and the request conflicts with the state of the world
   * around it. The state is no longer reachable through the shipped catalogue — see
   * `withDraftWording` — but the refusal is the floor under an instrument whose source ever comes
   * back empty, and a floor nobody stands on is a floor nobody notices has gone.
   */
  describe("with a catalogue that is somehow still draft", () => {
    withDraftWording();

    it("refuses the submission with a 409, aimed at the carrier", async () => {
      holder.client = seed().client;
      const res = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("disclosure_not_final");
    });
  });

  it("refuses an application that is not certified", async () => {
    holder.client = seed().client;
    const res = await call(`/${TOKEN}`, {
      method: "POST",
      body: JSON.stringify({ application: { ...APPLICATION.application, certified: false }, ssn: null }),
    });
    expect(res.status).toBe(400);
  });

  it("refuses a second submission with a conflict, not a dead link, and files nothing", async () => {
    const rec = seed({ submitted_at: "2026-08-01T00:00:00Z" });
    holder.client = rec.client;
    const res = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
    // 409, not 404: the link is perfectly good — it is this phase that is spent (A1, D-APP1).
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("already_submitted");
    expect(rec.rpcs()).toHaveLength(0);
  });
});

/**
 * A2 — the form saves itself, and a saved date of birth is not readable from the bare link.
 */
/**
 * ⚠ The certification is refused until the office has approved the document (F4, D-AX11).
 *
 * The applicant's page hands the application over and does not offer a signature until it comes back,
 * so this is the belt to that braces — and the status matters as much as the refusal: a 500 would
 * read to a driver as "the system is broken" when the truth is "nobody has read it yet".
 */
describe("certifying before the carrier has approved it", () => {
  afterEach(() => vi.restoreAllMocks());

  it("answers 409 and says what to do, rather than 500", async () => {
    publishAll();
    holder.client = seed({
      consented_at: "2026-08-20T09:00:00Z", review_requested_at: null, approved_at: null,
    }).client;
    const res = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not_yet_approved");
    expect(body.error.message).toContain("you sign it in their office");
  });
});

describe("the saved draft", () => {
  it("comes back with the link when there is nothing sensitive in it", async () => {
    holder.client = seedWithDraft({ first_name: "Susan" }).client;
    const res = await call(`/${TOKEN}`);
    const body = (await res.json()) as { draft: { locked: boolean; payload: Record<string, unknown> | null } };
    expect(body.draft.locked).toBe(false);
    expect(body.draft.payload).toEqual({ first_name: "Susan" });
  });

  it("withholds the body once it holds a date of birth (D-APP16)", async () => {
    holder.client = seedWithDraft({ first_name: "Susan", date_of_birth: "1980-04-01" }).client;
    const res = await call(`/${TOKEN}`);
    const body = (await res.json()) as { draft: { locked: boolean; payload: unknown; furthestSection: string } };
    expect(body.draft.locked).toBe(true);
    expect(body.draft.payload).toBeNull();
    // Not even in the envelope: whoever holds only the link never receives the date of birth back.
    expect(JSON.stringify(body)).not.toContain("1980-04-01");
    // Where they got to is not the secret, and hiding it would make a resumed session look lost.
    expect(body.draft.furthestSection).toBe("identity");
  });

  it("releases the body for the matching date of birth", async () => {
    holder.client = seedWithDraft({ first_name: "Susan", date_of_birth: "1980-04-01" }).client;
    const res = await call(`/${TOKEN}/unlock`, {
      method: "POST",
      body: JSON.stringify({ date_of_birth: "1980-04-01" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { locked: boolean; payload: Record<string, unknown> } };
    expect(body.draft.locked).toBe(false);
    expect(body.draft.payload.first_name).toBe("Susan");
  });

  it("gives a wrong date of birth the locked view, a 200, and no clue", async () => {
    const rec = seedWithDraft({ first_name: "Susan", date_of_birth: "1980-04-01" });
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/unlock`, {
      method: "POST",
      body: JSON.stringify({ date_of_birth: "1975-01-01" }),
    });
    // 200 and not 401: a failed guess is not an authentication failure, it changes nothing, and it
    // must not burn the link. The rate limiter is what throttles guessing.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { locked: boolean; payload: unknown } };
    expect(body.draft.locked).toBe(true);
    expect(body.draft.payload).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Susan");
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("saves a partial form with no credential at all", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Sus" }, section: "identity" }),
    });
    expect(res.status).toBe(200);
    // Half-typed and invalid against §391.21's schema, and saved anyway — a form that will not save
    // until it is valid cannot save at all until it is finished.
    expect((rec.rpcs()[0]!.args as Record<string, unknown>).p_payload).toEqual({ first_name: "Sus" });
  });

  /** D-APP3. The refusal is loud rather than a silent filter: the client never places the key in the
   *  draft object, so a payload carrying one is a client regression worth failing on. */
  it("refuses a draft carrying a Social Security number", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Susan", ssn: "123456789" }, section: null }),
    });
    expect(res.status).toBe(400);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses to save a draft over a filed application", async () => {
    const rec = seed({ submitted_at: "2026-08-01T00:00:00Z" });
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Susan" }, section: null }),
    });
    expect(res.status).toBe(409);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("tells an anonymous caller with a bad token nothing, on either route", async () => {
    holder.client = seed(null).client;
    const saved = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: {}, section: null }),
    });
    const unlocked = await call(`/${TOKEN}/unlock`, {
      method: "POST",
      body: JSON.stringify({ date_of_birth: "1980-04-01" }),
    });
    expect(saved.status).toBe(404);
    expect(unlocked.status).toBe(404);
    expect(((await saved.json()) as { error: { code: string } }).error.code).toBe("invalid_link");
    expect(((await unlocked.json()) as { error: { code: string } }).error.code).toBe("invalid_link");
  });
});

/**
 * A4 — §390.32(d) requires an electronic §391.21 application to include proof of 15 U.S.C. 7001(c)
 * consent, so it is the first act on the link and every other write path refuses before it.
 *
 * ⚠ The gate is armed by A0, not by A4: while the wording is `v0-draft` no consent can be recorded,
 * so requiring one would refuse every write with no way through and take the live application
 * offline. Both branches are pinned below, the closed one against a published version.
 */
describe("the ESIGN consent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is served with the link, as text the server composed", async () => {
    holder.client = seed().client;
    const res = await call(`/${TOKEN}`);
    const body = (await res.json()) as { esignConsent: { body: string; draft: boolean; required: boolean } };
    // Six clauses, in the statute's order — the disclosure 7001(c)(1) actually enumerates.
    expect(body.esignConsent.body).toContain("You can have these on paper instead");
    expect(body.esignConsent.body).toContain("What you need to read and keep these records");
    // ⚠ Final and asked for, since D-WORD1. The clauses were always the statute's own words; what
    // changed is that the version stopped calling them a draft, which is what `required` reads.
    expect(body.esignConsent.draft).toBe(false);
    expect(body.esignConsent.required).toBe(true);
  });

  /**
   * ⚠ The branch that used to be the live one: while the catalogue was draft, requiring a consent
   * nobody could record would have taken the application offline, so every write path stayed open.
   * D-WORD1 ended that state; the test stays because the REASONING is still load-bearing for any
   * instrument whose source ever comes back empty.
   */
  describe("while the catalogue is somehow still draft", () => {
    withDraftWording();

    it("leaves every write path open, rather than locking a door nobody can pass", async () => {
      holder.client = seed({ consented_at: null }).client;
      const saved = await call(`/${TOKEN}/draft`, {
        method: "PUT",
        body: JSON.stringify({ payload: { first_name: "Susan" }, section: null }),
      });
      expect(saved.status).toBe(200);
    });

    it("refuses to record a consent against it", async () => {
      const rec = seed();
      holder.client = rec.client;
      const res = await call(`/${TOKEN}/consent`, { method: "POST", body: "{}" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("disclosure_not_final");
      expect(rec.rpcs()).toHaveLength(0);
    });
  });

  it("closes every write path until the driver has consented", async () => {
    holder.client = seed({ consented_at: null }).client;
    const saved = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Susan" }, section: null }),
    });
    const sent = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
    const signed = await call(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }),
    });
    for (const res of [saved, sent, signed]) expect(res.status).toBe(409);
    expect(((await saved.json()) as { error: { code: string } }).error.code).toBe("esign_consent_required");
    expect(((await sent.json()) as { error: { code: string } }).error.code).toBe("esign_consent_required");
    expect(((await signed.json()) as { error: { code: string } }).error.code).toBe("esign_consent_required");
  });

  it("opens them again once the driver has consented", async () => {
    holder.client = seed({ consented_at: "2026-08-21T09:00:00Z" }).client;
    const saved = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Susan" }, section: null }),
    });
    expect(saved.status).toBe(200);
  });

  it("records one against the shipped wording, composed server-side", async () => {
    const rec = seed({ consented_at: null });
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/consent`, { method: "POST", body: "{}" });
    expect(res.status).toBe(201);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    // ⚠ The version names the statute and the date it was read, not a counter — so the row says
    // what was consented to without needing this repository at the right commit to decode it.
    expect(args.p_version).toBe(ESIGN_VERSION);
    // The request said nothing about what was consented to, and could not have.
    expect(String(args.p_text)).toContain("You can have these on paper instead");
  });

  it("tells an anonymous caller with a bad token nothing", async () => {
    holder.client = seed(null).client;
    const res = await call(`/${TOKEN}/consent`, { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_link");
  });
});

/**
 * §0.2, pinned at the boundary that made it a defect.
 *
 * `POST /:token/release` resolves the same token the submission spent. Until 0225 that meant the
 * signing `ApplyPage.vue` promised the driver answered 404 the moment they sent their application.
 */
describe("the link survives its own submission", () => {
  it("still opens after submission, showing what was sent", async () => {
    holder.client = seed({ submitted_at: "2026-08-01T00:00:00Z" }).client;
    const res = await call(`/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { phases: { submittedAt: string } }).phases.submittedAt).toBe(
      "2026-08-01T00:00:00Z",
    );
  });

  it("still reaches the signing endpoint after submission", async () => {
    holder.client = seed({ submitted_at: "2026-08-01T00:00:00Z" }, IDENTITY_TABLES).client;
    const res = await call(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }),
    });
    // ⚠ 201, and not 404 for a dead link — which is the whole difference A1 makes, now shown at
    // full strength. This used to be a 409 for draft wording: the endpoint was proved REACHABLE
    // but the call could not actually produce anything, so what the test pinned was a refusal
    // standing in for the behaviour. Since D-WORD1 the same call after a submission is a signature.
    expect(res.status).toBe(201);
  });

  it("refuses a fifth signature once the ceremony is closed", async () => {
    holder.client = seed({ releases_completed_at: "2026-08-01T00:00:00Z" }).client;
    const res = await call(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("releases_complete");
  });
});

/** Q-H3, at the edge: no real signature lands on wording no lawyer has read. */
describe("signing a release", () => {
  withDraftWording();

  it("refuses while the disclosure is draft, with a message aimed at the carrier", async () => {
    const rec = seed({}, IDENTITY_TABLES);
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("disclosure_not_final");
    expect(rec.writtenRows("driver_authorizations")).toHaveLength(0);
  });

  it("refuses a release that does not affirm ESIGN intent", async () => {
    holder.client = seed().client;
    const res = await call(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: false }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * The capture endpoints (A8, D-APP10).
 *
 * The surface property is the same one every route in this file carries — no bearer token, and no
 * fact about who exists leaks out of a refusal — plus one that belongs to staging alone: a confirm
 * for bytes that are not in the bucket is 422, not 404. The link is fine; the photograph is not, and
 * a page whose entire vocabulary for 404 is "this link is dead" must not be told otherwise.
 */
describe("photographing a document from the link", () => {
  const capturing = (storage: Record<string, (...args: never[]) => unknown>): SupabaseRecorder =>
    createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          // Consented — see `seed`. Since D-WORD1 a capture is a write like any other and the
          // §390.32(d) gate refuses it before the consent exists.
          consented_at: "2026-09-14T08:00:00Z", releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z", submitted_at: null,
        }],
        organizations: [{ name: "Silvicom Inc" }],
      },
      rpc: { stage_application_capture: { capture_id: "cap-1", captured_at: "2026-08-21T12:00:00Z", replaced_path: null } },
      storage,
    });

  it("mints an upload URL with no bearer token, and writes nothing", async () => {
    const rec = capturing({
      createSignedUploadUrl: (path: string) => ({ data: { signedUrl: "https://storage.test/u", token: "t", path }, error: null }),
    });
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/capture`, {
      method: "POST",
      body: JSON.stringify({ slot: "cdl_front", content_type: "image/webp" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { captureId: string; uploadUrl: string; storagePath: string };
    expect(body.uploadUrl).toBe("https://storage.test/u");
    // The response hands back a key and a URL and nothing about the carrier or the driver.
    expect(body.storagePath.startsWith(`${ORG}/inv-1/`)).toBe(true);
    expect(rec.writes()).toEqual([]);
  });

  it("refuses a slot the applicant was never offered", async () => {
    holder.client = capturing({}).client;
    const res = await call(`/${TOKEN}/capture`, {
      method: "POST",
      body: JSON.stringify({ slot: "operating_authority", content_type: "image/webp" }),
    });
    expect(res.status).toBe(400);
  });

  it("answers a dead link the way every other route here does", async () => {
    holder.client = seed(null).client;
    const res = await call(`/${TOKEN}/capture`, {
      method: "POST",
      body: JSON.stringify({ slot: "cdl_front", content_type: "image/webp" }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_link");
  });

  it("returns 422 — not 404 — when the bytes never arrived", async () => {
    const rec = capturing({ list: () => ({ data: [], error: null }) });
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/capture/${DRIVER}`, {
      method: "PUT",
      body: JSON.stringify({ slot: "cdl_front", content_type: "image/webp", sha256: "a1".repeat(32) }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("capture_upload_failed");
    // And nothing was staged: a slot must never claim to hold a photograph that is not there.
    expect(rec.rpcs()).toEqual([]);
  });

  it("records the slot once the object is in the bucket", async () => {
    holder.client = capturing({
      list: () => ({ data: [{ name: `${DRIVER}.webp`, id: "o", metadata: { size: 4096 } }], error: null }),
    }).client;
    const res = await call(`/${TOKEN}/capture/${DRIVER}`, {
      method: "PUT",
      body: JSON.stringify({ slot: "cdl_front", content_type: "image/webp", sha256: "a1".repeat(32) }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as { slot: string }).toMatchObject({ ok: true, slot: "cdl_front" });
  });
});

/**
 * The gate, against the only publishing mechanism production has (2026-09-13).
 *
 * ── WHY THIS BLOCK EXISTS AND THE ONE ABOVE WAS NOT ENOUGH ────────────────────────────────────
 * "closes every write path the moment the text is published" pins exactly the right property and
 * proved nothing, because it published by mocking `ESIGN_CONSENT.version`. 0338 moved publishing
 * into `org_disclosures`: a real carrier's rows overlay the constants, which stay `v0-draft`. So
 * every caller that asked the CONSTANT went on seeing a draft, and `requireEsignConsent` refuses
 * only while the consent can actually be given — meaning those callers had no gate at all.
 *
 * Measured before the fix, with the rows below in place and `consented_at` null: the draft save
 * answered 200, the capture 201, and the release **201** — a `driver_authorizations` row written,
 * electronically, for somebody who had never agreed to sign electronically. That is the §390.32(d)
 * gap A4 exists to close, and it would have opened the instant the first carrier pressed Publish on
 * `/settings/application-wording`.
 *
 * Mutate any one of the four `requireEsignConsent(invitation, …)` call sites back to the code's
 * placeholders and that path returns to 200/201 here.
 */
describe("with the carrier's wording published as rows, and no consent given", () => {
  /** Exactly what the publish service writes: one row per instrument, v1, newest wins. */
  const PUBLISHED = [
    ...AUTHORIZATION_PURPOSES.map((purpose) => ({
      instrument: purpose,
      version: "v1",
      title: DISCLOSURES[purpose].title,
      body: DISCLOSURES[purpose].body,
      clauses: null,
      intent: DISCLOSURES[purpose].intent,
      published_at: "2026-09-13T10:00:00Z",
      published_by: null,
    })),
    {
      instrument: "esign_consent",
      version: "v1",
      title: ESIGN_CONSENT.title,
      // Composed at publish time by `publishWording`, and stored — never recomposed on read.
      body: esignConsentBody(),
      clauses: ESIGN_CONSENT.clauses,
      intent: ESIGN_CONSENT.intent,
      published_at: "2026-09-13T10:00:00Z",
      published_by: null,
    },
  ];

  const seedPublished = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): SupabaseRecorder =>
    createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: null, releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z", submitted_at: null,
          review_requested_at: "2026-09-10T09:00:00Z", approved_at: "2026-09-11T09:00:00Z",
          ...over,
        }],
        organizations: [{ name: "Silvicom Inc" }],
        org_disclosures: PUBLISHED,
        application_drafts: [],
        driver_authorizations: [],
        ...extra,
      },
      rpc: {
        save_application_draft: { draft_id: "d-1", updated_at: "2026-09-13T10:05:00Z" },
        record_driver_release: { id: "rel-1", signed_count: 1, completed: false },
        submit_driver_application: { application_id: "app-1" },
      },
    });

  const refusal = async (res: Response): Promise<string> =>
    ((await res.json()) as { error: { code: string } }).error.code;

  it("refuses to save a draft", async () => {
    const rec = seedPublished();
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Susan" }, section: null }),
    });
    expect(res.status).toBe(409);
    expect(await refusal(res)).toBe("esign_consent_required");
    // A draft holds a date of birth. Nothing may be written before the consent exists.
    expect(rec.rpcs()).toEqual([]);
  });

  it("refuses to open a capture session", async () => {
    const res = await (async () => {
      holder.client = seedPublished().client;
      return call(`/${TOKEN}/capture`, {
        method: "POST",
        body: JSON.stringify({ slot: "cdl_front", content_type: "image/jpeg" }),
      });
    })();
    expect(res.status).toBe(409);
    expect(await refusal(res)).toBe("esign_consent_required");
  });

  it("refuses to record a release, and writes nothing", async () => {
    const rec = seedPublished();
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }),
    });
    expect(res.status).toBe(409);
    expect(await refusal(res)).toBe("esign_consent_required");
    // The one that was answering 201: a signature on published wording with no consent behind it.
    expect(rec.rpcs()).toEqual([]);
  });

  it("refuses the submission — the path that was always right, kept honest", async () => {
    holder.client = seedPublished().client;
    const res = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
    expect(res.status).toBe(409);
    expect(await refusal(res)).toBe("esign_consent_required");
  });

  it("opens all four again once the driver has consented", async () => {
    const rec = seedPublished({ consented_at: "2026-09-13T11:00:00Z" }, IDENTITY_TABLES);
    holder.client = rec.client;
    const saved = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Susan" }, section: null }),
    });
    const signed = await call(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }),
    });
    expect(saved.status).toBe(200);
    expect(signed.status).toBe(201);
    // And the signature carries the CARRIER's version and text, not the code's placeholder.
    const release = rec.rpcs().find((r) => r.fn === "record_driver_release")!.args as Record<string, unknown>;
    expect(release.p_version).toBe("v1");
  });
});

/**
 * ⚠ **What the driver is actually SHOWN once the office publishes — the end of the chain.**
 *
 * Everything else about publishing is pinned somewhere: the service assigns the version
 * (`carrierWording.test.ts`), the transcriptions match their sources (`packetWording.test.ts`,
 * `pspDisclosure.test.ts`), the office's screen offers them (`ApplicationWordingPage.test.ts`). None
 * of that proves the one thing the whole feature exists for — that the words which reach the
 * applicant's phone are the carrier's and the regulator's rather than the placeholders an engineer
 * wrote. This is the only test that opens the link and reads what comes back.
 *
 * It matters because the failure would be silent and total: `carrierWording()` overlays published
 * rows onto the code's constants, and an overlay that quietly did nothing would leave every screen
 * looking exactly as it does today, still working, still signing — against the wrong text.
 */
describe("what the applicant is served once the carrier has published", () => {
  /** The real thing: page 19/14/21 out of the packet, and FMCSA's own PSP form. */
  const LIVE = [
    ...(["fcra_disclosure", "previous_employer", "drug_alcohol"] as const).map((instrument) => {
      const w = packetWording(instrument)!;
      return {
        instrument, version: "v1", title: w.title, body: w.body, clauses: null, intent: w.intent,
        published_at: "2026-09-13T10:00:00Z", published_by: null,
      };
    }),
    (() => {
      const w = pspDisclosure("Silvicom Inc");
      return {
        instrument: "psp", version: "v1", title: w.title, body: w.body, clauses: null,
        intent: w.intent, published_at: "2026-09-13T10:00:00Z", published_by: null,
      };
    })(),
    {
      instrument: "esign_consent", version: "v1", title: ESIGN_CONSENT.title,
      body: esignConsentBody(), clauses: ESIGN_CONSENT.clauses, intent: ESIGN_CONSENT.intent,
      published_at: "2026-09-13T10:00:00Z", published_by: null,
    },
  ];

  const open = async (): Promise<{
    releases: Array<{ purpose: string; version: string; title: string; body: string; intent: string; draft: boolean }>;
    esignConsent: { draft: boolean; required: boolean };
  }> => {
    holder.client = createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: "2026-09-13T11:00:00Z", releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z", submitted_at: null,
        }],
        organizations: [{ name: "Silvicom Inc" }],
        org_disclosures: LIVE,
        application_drafts: [],
      },
    }).client;
    const res = await call(`/${TOKEN}`);
    expect(res.status).toBe(200);
    return res.json() as never;
  };

  it("serves the carrier's own wording, not the placeholder we ship", async () => {
    const { releases } = await open();
    const fcra = releases.find((r) => r.purpose === "fcra_disclosure")!;
    expect(fcra.title).toBe("FAIR CREDIT REPORTING ACT DISCLOSURE");
    expect(fcra.body).toContain("The Federal Motor Carrier Safety Regulations (FMCSR) require motor carriers");
    // The placeholder's opening words. If these ever come back, the overlay has stopped working.
    expect(fcra.body).not.toContain("In connection with your application for employment, and throughout");
  });

  it("serves FMCSA's PSP language in whole, with the carrier named in it", async () => {
    const { releases } = await open();
    const psp = releases.find((r) => r.purpose === "psp")!;
    expect(psp.title).toBe(PSP_DISCLOSURE_TITLE);
    expect(psp.body).toContain("application for employment with Silvicom Inc (\u201cProspective Employer\u201d)");
    // Every mandated paragraph reaches the phone — the whole point of the refusal at publish time
    // is worth nothing if the read path drops one.
    expect(missingPspParagraphs(psp.body)).toEqual([]);
    expect(psp.intent).toBe(PSP_MANDATED_INTENT);
  });

  it("opens every gate it was holding shut", async () => {
    const { releases, esignConsent } = await open();
    // `draft: false` is what `ApplyPage` reads to stop skipping the signing ceremony, and
    // `applicationWordingIsDraft()` reads the same versions to stop refusing the submission.
    expect(releases.map((r) => r.draft)).toEqual([false, false, false, false, false]);
    // The carrier published four; the fifth (D-AF4) is served at the shipped version, which is the
    // overlay working per instrument rather than all-or-nothing.
    expect(releases.map((r) => r.version)).toEqual(["v1", "v1", "v1", "v1", CLEARINGHOUSE_VERSION]);
    expect(esignConsent.draft).toBe(false);
    expect(esignConsent.required).toBe(true);
  });

  it("takes an override for one instrument and the shipped catalogue for the rest", async () => {
    /**
     * ⚠ The state the old version of this test imagined — "half published, so still refuses" — is
     * gone with D-WORD1, and its absence is the change worth pinning. `org_disclosures` is now an
     * OVERRIDE laid over a catalogue that is already final, so a carrier that publishes one
     * instrument gets their words for that one and FMCSA's or their packet's for the other five.
     * Partial publishing can no longer half-break an applicant, which is exactly what it used to do.
     */
    holder.client = createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: "2026-09-14T08:00:00Z", releases_completed_at: null, application_sent_at: "2026-09-14T09:00:00Z", submitted_at: null,
          review_requested_at: "2026-09-10T09:00:00Z", approved_at: "2026-09-11T09:00:00Z",
        }],
        organizations: [{ name: "Silvicom Inc" }],
        org_disclosures: [{
          instrument: "drug_alcohol", version: "v1", title: "Our own testing consent",
          body: "The carrier's replacement wording.", clauses: null, intent: "I agree.",
          published_at: "2026-09-14T10:00:00Z", published_by: null,
        }],
        application_drafts: [],
        // D-PKT15: submitting needs the carrier's form signed through, which this test is not about.
        application_packet_marks: signedPacket(),
      },
      rpc: { submit_driver_application: { application_id: "app-1" } },
    }).client;

    const res = await call(`/${TOKEN}`);
    const { releases } = (await res.json()) as { releases: Array<{ purpose: string; version: string; body: string; draft: boolean }> };
    const overridden = releases.find((r) => r.purpose === "drug_alcohol")!;
    expect(overridden.version).toBe("v1");
    expect(overridden.body).toBe("The carrier's replacement wording.");
    // And the other three are untouched — still FMCSA's and the packet's, still not draft.
    expect(releases.every((r) => !r.draft)).toBe(true);
    expect(missingPspParagraphs(releases.find((r) => r.purpose === "psp")!.body)).toEqual([]);

    // Which means the submission goes through rather than meeting `disclosure_not_final`.
    const sent = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
    expect(sent.status).toBe(201);
  });
});

/**
 * The error code off a refusal body, for the two route suites below.
 *
 * ⚠ Asserting the CODE and not only the status is the point: a route that is not mounted answers
 * 404 as well, so a status-only assertion cannot tell a refusal from an absence.
 */
const refusalCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

/**
 * The document route, through the mount rather than through `applicantCopy`.
 *
 * ⚠ These exist because of a measurement taken when this file's routes were split for C1: removing
 * `publicApplicationDocumentsRouter()` from the parent entirely left all 706 recruiting tests green.
 * `applicationCopy.test.ts` pins the SERVICE thoroughly and nothing pinned that it was reachable, so
 * the one thing a split can break — the mount — was the one thing not covered. Both assertions below
 * turn red if the sub-router stops being mounted.
 */
describe("the applicant's filed copy, as a route", () => {
  it("answers not_submitted on a live link with nothing filed behind it", async () => {
    holder.client = seed().client;
    const res = await call(`/${TOKEN}/document`);
    // 409 and not 404: the link is perfectly good and the answer is "not yet". An unmounted route
    // would answer 404 here, which is what makes this the assertion that sees the mount.
    expect(res.status).toBe(409);
    expect(await refusalCode(res)).toBe("not_submitted");
  });

  it("gives a dead link the same refusal every other route gives it", async () => {
    holder.client = seed(null).client;
    const res = await call(`/${TOKEN}/document`);
    expect(res.status).toBe(404);
    // ⚠ The code, not just the status — a 404 from a route that is not mounted carries a different
    // body, and this surface's whole discipline is that every dead link answers `invalid_link`.
    expect(await refusalCode(res)).toBe("invalid_link");
  });
});

/**
 * The tenth route (C1): the packet the driver is about to sign, through the mount.
 *
 * ⚠ The rendering itself is pinned by `applicationReadingCopy.test.ts` — the band, the marks, the
 * refusals. What can only be pinned HERE is that the route is reachable and what it puts on the
 * wire: PDF bytes rather than a URL, shown inline rather than downloaded, and never cached.
 */
describe("the packet a driver reads before signing it, as a route", () => {
  const readingSeed = (over: Record<string, unknown> = {}): SupabaseRecorder =>
    createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: "2026-09-14T08:00:00Z", releases_completed_at: "2026-09-15T08:00:00Z", application_sent_at: "2026-09-14T09:00:00Z",
          // ⚠ Unapproved on purpose (D-HUI12): reading does not wait for the office, and the
          // ordinary case for this route is a link nobody in the office has opened yet.
          review_requested_at: null, approved_at: null, submitted_at: null,
          ...over,
        }],
        organizations: [{ name: "Silvicom Inc", legal_address: null }],
        application_drafts: [{ payload: APPLICATION.application }],
        application_packet_marks: [],
        driver_authorizations: [], esign_consents: [], application_captures: [], documents: [],
      },
    });

  it("serves the carrier's paper as inline PDF bytes, uncached", async () => {
    holder.client = readingSeed().client;
    const res = await call(`/${TOKEN}/packet`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    // ⚠ Inline, not attachment: a download prompt in the middle of a ceremony is how somebody loses
    // their place on a twenty-two stop walk.
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("content-disposition")).toContain("your-application.pdf");
    // Somebody's employment history, and a document whose mark count changes at every stop.
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("gives a dead link the same refusal every other route gives it", async () => {
    holder.client = seed(null).client;
    const res = await call(`/${TOKEN}/packet`);
    expect(res.status).toBe(404);
    // ⚠ The code, not just the status — an unmounted route answers 404 too.
    expect(await refusalCode(res)).toBe("invalid_link");
  });

  it("sends a driver who has already filed to their filed copy", async () => {
    holder.client = readingSeed({ submitted_at: "2026-09-18T11:00:00Z" }).client;
    const res = await call(`/${TOKEN}/packet`);
    // 409, not 404: the link is perfectly good and that document is finished.
    expect(res.status).toBe(409);
    expect(await refusalCode(res)).toBe("already_filed");
  });
});
