import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { closeTestServer } from "../testing/httpServer.js";
import { hashInvitationToken } from "../services/applicationIntake.js";

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

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/public/application${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });

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

describe("submitting", () => {
  it("accepts a certified application without any credential", async () => {
    const rec = seed();
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
