import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
} from "@silvicom/shared";
import { packetWording } from "../packetWording.js";
import { PSP_DISCLOSURE_TITLE, PSP_MANDATED_INTENT, missingPspParagraphs, pspDisclosure } from "../pspDisclosure.js";

/**
 * The public surface, end to end and unauthenticated.
 *
 * Two properties are pinned that nothing else can pin: this path takes NO bearer token and still
 * writes, and it leaks nothing about who exists. Every dead link answers 404 with one code, and a
 * successful submission hands back an application id and not the org or driver it resolved to.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

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

const seed = (over: Record<string, unknown> | null = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over
        ? [{
            id: "inv-1", org_id: ORG, driver_id: DRIVER,
            token_hash: hashInvitationToken(TOKEN),
            expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
            consented_at: null, releases_completed_at: null, submitted_at: null,
            // F4: submitting requires an approved application, so the default link is one the office
            // has read and approved. A test about a phase refusal overrides these two.
            review_requested_at: "2026-09-10T09:00:00Z", approved_at: "2026-09-11T09:00:00Z",
            ...over,
          }]
        : [],
      organizations: [{ name: "Silvicom Inc" }],
      driver_authorizations: [{ id: "auth-1" }],
      application_drafts: [],
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
        consented_at: null, releases_completed_at: null, submitted_at: null,
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
    // The wording is SERVED, so what somebody signed is a fact the server can prove — never shipped
    // in the client bundle where a build could change it.
    expect(body.releases.map((r) => r.purpose)).toEqual([
      "fcra_disclosure", "psp", "previous_employer", "drug_alcohol",
    ]);
    expect(body.releases.every((r) => r.body.length > 0)).toBe(true);
    // Q-H3: every instrument still ships as draft, and the applicant's page is told so.
    expect(body.releases.every((r) => r.draft)).toBe(true);
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
          consented_at: null, releases_completed_at: null,
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
          consented_at: null, releases_completed_at: null,
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
  // publishAll() is per-test here, so it has to be undone per-test — a leak would silently open the
  // wording gate for every case after it, which is exactly the refusal two of them are pinning.
  afterEach(() => vi.restoreAllMocks());

  it("accepts a certified application without any credential", async () => {
    publishAll();
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
   * ⚠ The §390.32(d) window at the edge of the API (2026-08-23).
   *
   * 409, not 500: the link is perfectly good and the request conflicts with the state of the world
   * around it — the carrier has not published its wording — which is what that status is for.
   */
  it("refuses the submission with a 409 while the carrier's wording is draft", async () => {
    holder.client = seed().client;
    const res = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("disclosure_not_final");
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
    expect(body.error.message).toContain("reopen your link");
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
  const publish = () => vi.spyOn(ESIGN_CONSENT, "version", "get").mockReturnValue("v1");
  afterEach(() => vi.restoreAllMocks());

  it("is served with the link, as text the server composed", async () => {
    holder.client = seed().client;
    const res = await call(`/${TOKEN}`);
    const body = (await res.json()) as { esignConsent: { body: string; draft: boolean; required: boolean } };
    // Six clauses, in the statute's order — the disclosure 7001(c)(1) actually enumerates.
    expect(body.esignConsent.body).toContain("You can have these on paper instead");
    expect(body.esignConsent.body).toContain("What you need to read and keep these records");
    expect(body.esignConsent.draft).toBe(true);
    // Not asked for while it cannot be recorded.
    expect(body.esignConsent.required).toBe(false);
  });

  it("leaves every write path open while the wording is draft", async () => {
    holder.client = seed().client;
    const saved = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Susan" }, section: null }),
    });
    expect(saved.status).toBe(200);
  });

  it("closes every write path the moment the text is published", async () => {
    publish();
    holder.client = seed().client;
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
    publish();
    holder.client = seed({ consented_at: "2026-08-21T09:00:00Z" }).client;
    const saved = await call(`/${TOKEN}/draft`, {
      method: "PUT",
      body: JSON.stringify({ payload: { first_name: "Susan" }, section: null }),
    });
    expect(saved.status).toBe(200);
  });

  it("refuses to record a consent to draft wording", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/consent`, { method: "POST", body: "{}" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("disclosure_not_final");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("records one against published wording, composed server-side", async () => {
    publish();
    const rec = seed();
    holder.client = rec.client;
    const res = await call(`/${TOKEN}/consent`, { method: "POST", body: "{}" });
    expect(res.status).toBe(201);
    const args = rec.rpcs()[0]!.args as Record<string, unknown>;
    expect(args.p_version).toBe("v1");
    // The request said nothing about what was consented to, and could not have.
    expect(String(args.p_text)).toContain("You can have these on paper instead");
  });

  it("tells an anonymous caller with a bad token nothing", async () => {
    publish();
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
    holder.client = seed({ submitted_at: "2026-08-01T00:00:00Z" }).client;
    const res = await call(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }),
    });
    // 409 for DRAFT WORDING — the carrier's outstanding act (Q-H3) — and not 404 for a dead link,
    // which is the whole difference A1 makes. A0 turns this same call into a signature.
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("disclosure_not_final");
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
  it("refuses while the disclosure is draft, with a message aimed at the carrier", async () => {
    const rec = seed();
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
          consented_at: null, releases_completed_at: null, submitted_at: null,
        }],
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

  const seedPublished = (over: Record<string, unknown> = {}): SupabaseRecorder =>
    createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: null, releases_completed_at: null, submitted_at: null,
          review_requested_at: "2026-09-10T09:00:00Z", approved_at: "2026-09-11T09:00:00Z",
          ...over,
        }],
        organizations: [{ name: "Silvicom Inc" }],
        org_disclosures: PUBLISHED,
        application_drafts: [],
        driver_authorizations: [],
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
    const rec = seedPublished({ consented_at: "2026-09-13T11:00:00Z" });
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
          consented_at: "2026-09-13T11:00:00Z", releases_completed_at: null, submitted_at: null,
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
    expect(releases.map((r) => r.draft)).toEqual([false, false, false, false]);
    expect(releases.map((r) => r.version)).toEqual(["v1", "v1", "v1", "v1"]);
    expect(esignConsent.draft).toBe(false);
    expect(esignConsent.required).toBe(true);
  });

  it("still refuses while only some of it is published", async () => {
    // The half-finished state an office will really be in, between the first Publish and the last.
    holder.client = createSupabaseRecorder({
      tables: {
        application_invitations: [{
          id: "inv-1", org_id: ORG, driver_id: DRIVER,
          token_hash: hashInvitationToken(TOKEN),
          expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
          consented_at: "2026-09-13T11:00:00Z", releases_completed_at: null, submitted_at: null,
          review_requested_at: "2026-09-10T09:00:00Z", approved_at: "2026-09-11T09:00:00Z",
        }],
        organizations: [{ name: "Silvicom Inc" }],
        org_disclosures: LIVE.filter((r) => r.instrument !== "psp"),
        application_drafts: [],
      },
      rpc: { submit_driver_application: { application_id: "app-1" } },
    }).client;
    const res = await call(`/${TOKEN}`, { method: "POST", body: JSON.stringify(APPLICATION) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("disclosure_not_final");
  });
});
