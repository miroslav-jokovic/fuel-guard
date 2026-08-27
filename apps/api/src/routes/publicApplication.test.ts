import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";
import { hashInvitationToken } from "../services/applicationIntake.js";
import { APPLICATION_RELEASE_ORDER, DISCLOSURES, ESIGN_CONSENT } from "@silvicom/shared";

/**
 * The public surface, end to end and unauthenticated.
 *
 * Two properties are pinned that nothing else can pin: this path takes NO bearer token and still
 * writes, and it leaks nothing about who exists. Every dead link answers 404 with one code, and a
 * successful submission hands back an application id and not the org or driver it resolved to.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

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
      submittedAt: null,
    });
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
