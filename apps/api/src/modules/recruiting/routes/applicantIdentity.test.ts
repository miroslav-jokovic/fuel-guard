import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import {
  createSupabaseRecorder,
  expectOrgScoped,
  type SupabaseRecorder,
} from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashInvitationToken } from "../applicationIntake.js";

/**
 * The applicant's identity, taken with the permissions (AF3, D-AF1) and written by one function
 * (D-AF8, `record_applicant_identity`, 0365).
 *
 * ⚠ The recorder does not execute SQL, so what these pin is the TypeScript half: which caller passes
 * which `p_overwrite`, what is refused before the function is ever called, and what is and is not
 * handed back. The function's own semantics — fill-only against overwrite, the draft following the
 * row — are pinned in `supabase/tests/applicant-flow-phases.test.mjs`, against real Postgres.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";
const TOKEN = "c".repeat(43);
const DOB = "1980-04-01";

const IDENTITY = { date_of_birth: DOB, cdl_number: "PA334554", cdl_state: "PA" };
const ROW_WITH_IDENTITY = [{ id: DRIVER, org_id: ORG, ...IDENTITY }];
const ROW_WITHOUT_IDENTITY = [{ id: DRIVER, org_id: ORG, date_of_birth: null, cdl_number: null, cdl_state: null }];
const DRAFT_WITH_IDENTITY = [{ payload: { ...IDENTITY, first_name: "Susan" }, furthest_section: null, updated_at: "2026-09-24T10:00:00Z" }];

const invitation = (over: Record<string, unknown> = {}) => ({
  id: INV, org_id: ORG, driver_id: DRIVER,
  token_hash: hashInvitationToken(TOKEN),
  expires_at: "2099-01-01T00:00:00Z", revoked_at: null,
  // Consented: the shipped wording is final, so the §390.32(d) gate is armed on every link.
  consented_at: "2026-09-24T09:00:00Z",
  releases_completed_at: null, review_requested_at: null, approved_at: null, submitted_at: null,
  ...over,
});

const seed = (over: {
  invitation?: Record<string, unknown> | null;
  drivers?: unknown[];
  drafts?: unknown[];
  rpc?: Record<string, unknown>;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [invitation(over.invitation)],
      organizations: [{ name: "Silvicom Inc" }],
      drivers: over.drivers ?? ROW_WITHOUT_IDENTITY,
      application_drafts: over.drafts ?? [],
      driver_authorizations: [],
      audit_logs: [],
    },
    rpc: {
      record_applicant_identity: { draft_id: "d-1", kept_existing: [] },
      record_driver_release: { authorization_id: "a-1", signed_count: 1, completed: false },
      save_application_draft: { draft_id: "d-1", updated_at: "2026-09-24T10:05:00Z" },
      ...over.rpc,
    },
  });

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  recruiter: ctx("recruiter"),
  auditor: ctx("auditor"),
  dispatcher: ctx("dispatcher"),
};

let server: Server;
let baseUrl: string;
let seq = 0;

/** A distinct address per call — the public surface is rate limited per IP (`publicApplication.test.ts`). */
const pub = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/public/application${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(seq++ % 250) + 1}` },
  });

const office = (path: string, token: string | null, body: unknown) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const code = async (res: Response): Promise<string> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code ?? "";

const identityCall = (rec: SupabaseRecorder) => rec.rpcs().find((r) => r.fn === "record_applicant_identity");

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("the applicant enters their identity", () => {
  it("writes it through the one writer, fill-only, for this link's invitation", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/identity`, {
      method: "POST",
      body: JSON.stringify({ ...IDENTITY, cdl_number: "  PA334554  " }),
    });
    expect(res.status).toBe(201);
    const args = identityCall(rec)!.args as Record<string, unknown>;
    // ⚠ The applicant FILLS; only the office overwrites (D-AF8). This is the line a mutation to
    // `true` has to get past.
    expect(args.p_overwrite).toBe(false);
    expect(args).toMatchObject({ p_org: ORG, p_invitation: INV, p_driver: DRIVER, p_dob: DOB, p_cdl_number: "PA334554" });
  });

  it("names what the carrier already had, and never says what it is", async () => {
    holder.client = seed({ rpc: { record_applicant_identity: { draft_id: "d-1", kept_existing: ["date_of_birth"] } } }).client;
    const res = await pub(`/${TOKEN}/identity`, { method: "POST", body: JSON.stringify(IDENTITY) });
    expect(await res.json()).toEqual({ ok: true, keptExisting: ["date_of_birth"] });
  });

  it("refuses before the electronic-records consent, writing nothing", async () => {
    const rec = seed({ invitation: { consented_at: null } });
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/identity`, { method: "POST", body: JSON.stringify(IDENTITY) });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("esign_consent_required");
    expect(identityCall(rec)).toBeUndefined();
  });

  it("refuses once the application is filed, writing nothing", async () => {
    const rec = seed({ invitation: { submitted_at: "2026-09-20T00:00:00Z" } });
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/identity`, { method: "POST", body: JSON.stringify(IDENTITY) });
    expect(res.status).toBe(409);
    expect(identityCall(rec)).toBeUndefined();
  });

  it("refuses an incomplete identity at the schema", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}/identity`, {
      method: "POST",
      body: JSON.stringify({ date_of_birth: DOB, cdl_number: "", cdl_state: "PA" }),
    });
    expect(res.status).toBe(400);
    expect(identityCall(rec)).toBeUndefined();
  });
});

describe("what the link reports about identity", () => {
  const opened = async (rec: SupabaseRecorder): Promise<{ text: string; body: { identityComplete: boolean } }> => {
    holder.client = rec.client;
    const res = await pub(`/${TOKEN}`);
    const text = await res.text();
    return { text, body: JSON.parse(text) as { identityComplete: boolean } };
  };

  it("is complete only when the row and the draft both hold all three", async () => {
    expect((await opened(seed({ drivers: ROW_WITH_IDENTITY, drafts: DRAFT_WITH_IDENTITY }))).body.identityComplete).toBe(true);
    expect((await opened(seed({ drivers: ROW_WITHOUT_IDENTITY, drafts: [] }))).body.identityComplete).toBe(false);
  });

  /**
   * ⚠ The discriminating fixture: an applicant from before AF3 whose draft holds a licence they
   * typed into the form, and whose row holds nothing — so PSP still cannot be ordered. A check on
   * the draft keys alone calls them complete and never sends them through the identity screen.
   */
  it("is not complete for a draft that holds identity the row does not", async () => {
    expect((await opened(seed({ drivers: ROW_WITHOUT_IDENTITY, drafts: DRAFT_WITH_IDENTITY }))).body.identityComplete).toBe(false);
  });

  /**
   * ⚠ The mirror case, and the one a mutation found missing: a row that already holds a licence — a
   * rehire, or a driver the office edited on the roster — and a draft that does not. The form reads
   * the draft, so it would show blank fields it refuses to let the applicant fill; the identity
   * screen must run once, and the function copies the row's values into the draft.
   */
  it("is not complete for a row that holds identity the draft does not", async () => {
    expect((await opened(seed({ drivers: ROW_WITH_IDENTITY, drafts: [] }))).body.identityComplete).toBe(false);
  });

  it("answers with a boolean and never reads the date of birth back to the bare link", async () => {
    const { text } = await opened(seed({ drivers: ROW_WITH_IDENTITY, drafts: DRAFT_WITH_IDENTITY }));
    expect(text).not.toContain(DOB);
    expect(text).not.toContain("PA334554");
  });
});

describe("signing a permission needs identity first (D-AF1)", () => {
  const sign = () =>
    pub(`/${TOKEN}/release`, {
      method: "POST",
      body: JSON.stringify({ purpose: "psp", signed_name: "Susan Godfrey", esign_consent: true }),
    });

  it("refuses identity_missing, before any signature is recorded", async () => {
    const rec = seed({ drivers: ROW_WITHOUT_IDENTITY, drafts: [] });
    holder.client = rec.client;
    const res = await sign();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("identity_missing");
    expect(rec.rpcs().find((r) => r.fn === "record_driver_release")).toBeUndefined();
  });

  it("signs once identity is on file", async () => {
    holder.client = seed({ drivers: ROW_WITH_IDENTITY, drafts: DRAFT_WITH_IDENTITY }).client;
    expect((await sign()).status).toBe(201);
  });
});

/**
 * ⚠ The hole AF2's review found: `save_application_draft` replaces the payload wholesale, so a tab
 * opened before the identity was written could put an old licence back into the draft on its next
 * autosave — a second identity writer arriving by the side door.
 */
describe("the draft save keeps identity the server's", () => {
  const save = (payload: Record<string, unknown>) =>
    pub(`/${TOKEN}/draft`, { method: "PUT", body: JSON.stringify({ payload, section: "licence" }) });
  const savedPayload = (rec: SupabaseRecorder) =>
    (rec.rpcs().find((r) => r.fn === "save_application_draft")!.args as { p_payload: Record<string, unknown> }).p_payload;

  it("lays the row's identity over what a stale tab sent, and keeps every other answer", async () => {
    const rec = seed({ drivers: ROW_WITH_IDENTITY });
    holder.client = rec.client;
    const res = await save({ first_name: "Susan", cdl_number: "OLD-TAB", cdl_state: "IN" });
    expect(res.status).toBe(200);
    expect(savedPayload(rec)).toEqual({ first_name: "Susan", ...IDENTITY });
  });

  it("leaves what the applicant typed alone while nothing is on the row", async () => {
    const rec = seed({ drivers: ROW_WITHOUT_IDENTITY });
    holder.client = rec.client;
    await save({ first_name: "Susan", cdl_number: "TYPED", date_of_birth: DOB });
    expect(savedPayload(rec)).toEqual({ first_name: "Susan", cdl_number: "TYPED", date_of_birth: DOB });
  });
});

describe("the office corrects identity", () => {
  const correct = (token: string | null, body: unknown = IDENTITY) =>
    office(`/applications/${INV}/identity`, token, body);

  it("overwrites through the same writer, and audits the act without the values", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await correct("recruiter");
    expect(res.status).toBe(200);
    expect((identityCall(rec)!.args as Record<string, unknown>).p_overwrite).toBe(true);
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "application_identity_corrected", entity_id: INV });
    // ⚠ apps/api/CLAUDE.md: never log a licence number. The row-change trigger on `drivers` keeps
    // the before and after where that table's access rules apply.
    expect(JSON.stringify(audit)).not.toContain("PA334554");
    expect(JSON.stringify(audit)).not.toContain(DOB);
  });

  it("scopes the office's correction to the caller's org", async () => {
    const rec = seed();
    holder.client = rec.client;
    await correct("recruiter");
    expectOrgScoped(rec, ORG);
    expect((identityCall(rec)!.args as Record<string, unknown>).p_org).toBe(ORG);
  });

  it("404s an invitation that is not this org's, and writes nothing", async () => {
    const rec = seed({ invitation: null });
    holder.client = rec.client;
    const res = await correct("recruiter");
    expect(res.status).toBe(404);
    expect(identityCall(rec)).toBeUndefined();
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses a filed application with a conflict, not a failure", async () => {
    holder.client = seed({ rpc: { record_applicant_identity: { error: { code: "AI003", message: "application_already_submitted" } } } }).client;
    const res = await correct("recruiter");
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("already_filed");
  });

  it("refuses a reader, a role outside the section, and the unauthenticated", async () => {
    for (const token of ["auditor", "dispatcher"]) {
      const rec = seed();
      holder.client = rec.client;
      expect((await correct(token)).status, token).toBe(403);
      expect(identityCall(rec), token).toBeUndefined();
    }
    expect((await correct(null)).status).toBe(401);
  });
});
