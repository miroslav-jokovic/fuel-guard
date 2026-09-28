import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The office correcting Part 1 (Q-AW36 (a)), and the identity correction on a v2 link.
 *
 * ⚠ The recorder does not execute SQL, so these pin the TypeScript half: what reaches
 * `record_applicant_intake` (overwrite, the whole list in order, the current licence replaced), what is
 * refused before it is ever called, and that the audit names fields and never values. The function's
 * own overwrite semantics are pinned against real Postgres in `supabase/tests/`.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";

const CORRECTION = {
  phone: "(708) 236-5732",
  address_line1: "12 Depot Rd",
  address_line2: null,
  city: "Joliet",
  state: "il",
  postal_code: "60432",
  cdl_class: "A",
  licences: [
    { state_code: "IL", licence_number: "D123-4567", expires_on: "2029-01-01" },
    { state_code: "IN", agency: "Indiana BMV", licence_number: "IN-555", expires_on: "2021-06-30" },
  ],
};

const STORED_LICENCES = [
  // Out of order on purpose: the list is the positions, whatever order the rows arrive in.
  { invitation_id: INV, position: 1, state_code: "OH", agency: null, licence_number: "OH-1", expires_on: "2020-01-31" },
  { invitation_id: INV, position: 0, state_code: "PA", agency: null, licence_number: "PA-OLD", expires_on: "2028-05-01" },
];

const seed = (over: {
  invitation?: Record<string, unknown> | null;
  intake?: boolean;
  licences?: unknown[];
  rpc?: Record<string, unknown>;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [{
        id: INV, org_id: ORG, driver_id: DRIVER, approved_at: null, ...over.invitation,
      }],
      application_intakes: over.intake === false ? [] : [{ id: "intake-1", invitation_id: INV }],
      application_intake_licences: over.licences ?? STORED_LICENCES,
      drivers: [{ id: DRIVER, org_id: ORG, date_of_birth: null, cdl_number: null, cdl_state: null }],
      audit_logs: [],
    },
    rpc: {
      record_applicant_intake: { intake_id: "intake-1", licence_count: 2, kept_existing: [] },
      record_applicant_identity: { draft_id: "d-1", kept_existing: [] },
      ...over.rpc,
    },
  });

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { recruiter: ctx("recruiter"), auditor: ctx("auditor"), dispatcher: ctx("dispatcher") };

let server: Server;
let baseUrl: string;

const office = (path: string, token: string | null, body: unknown) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const correct = (token: string | null = "recruiter", body: unknown = CORRECTION) =>
  office(`/applications/${INV}/part-one`, token, body);
const code = async (res: Response): Promise<string> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code ?? "";
const intakeCall = (rec: SupabaseRecorder) =>
  rec.rpcs().find((r) => r.fn === "record_applicant_intake")?.args as Record<string, unknown> | undefined;

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

describe("the office corrects Part 1", () => {
  it("overwrites through the one intake writer — the facts, and the whole list in order", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await correct();
    expect(res.status).toBe(200);
    const args = intakeCall(rec)!;
    expect(args).toMatchObject({ p_org: ORG, p_invitation: INV, p_driver: DRIVER, p_overwrite: true, p_endorsements: null });
    // Normalised by the contract: E.164, the state upper-cased, the second line cleared.
    expect(args.p_intake).toEqual({
      phone: "+17082365732", address_line1: "12 Depot Rd", address_line2: null, city: "Joliet",
      state: "IL", postal_code: "60432", cdl_class: "A",
    });
    expect(args.p_licences).toEqual([
      { position: 0, state_code: "IL", agency: null, licence_number: "D123-4567", expires_on: "2029-01-01", source: "intake" },
      { position: 1, state_code: "IN", agency: "Indiana BMV", licence_number: "IN-555", expires_on: "2021-06-30", source: "intake" },
    ]);
    // Never the identity writer on its own: the intake writer calls it from inside, from position 0.
    expect(rec.rpcs().some((r) => r.fn === "record_applicant_identity")).toBe(false);
  });

  it("audits the act by field name, and never a value", async () => {
    const rec = seed();
    holder.client = rec.client;
    await correct();
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "application_part_one_corrected", entity_id: INV, actor_id: "u-recruiter" });
    expect((audit!.meta as { fields: string[] }).fields).toEqual([
      "phone", "address_line1", "address_line2", "city", "state", "postal_code", "cdl_class", "licences",
    ]);
    for (const value of ["7082365732", "12 Depot Rd", "D123-4567", "IN-555", "60432"]) {
      expect(JSON.stringify(audit)).not.toContain(value);
    }
  });

  it("scopes every read and the write to the caller's org", async () => {
    const rec = seed();
    holder.client = rec.client;
    await correct();
    expectOrgScoped(rec, ORG);
  });

  it("404s an invitation that is not this org's, and writes nothing", async () => {
    const rec = seed({ invitation: null });
    holder.client = rec.client;
    const res = await correct();
    expect(res.status).toBe(404);
    expect(rec.rpcs()).toEqual([]);
    expect(rec.writes()).toHaveLength(0);
  });

  /** Approval tells the driver "this document, now" — the draft's own corrections stop there too. */
  it("refuses once the office has approved the application, writing nothing", async () => {
    const rec = seed({ invitation: { approved_at: "2026-09-27T10:00:00Z" } });
    holder.client = rec.client;
    const res = await correct();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_editable");
    expect(rec.rpcs()).toEqual([]);
  });

  it("refuses a legacy application — it has no Part 1 to correct", async () => {
    const rec = seed({ intake: false });
    holder.client = rec.client;
    const res = await correct();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("not_part_one");
    expect(rec.rpcs()).toEqual([]);
  });

  it.each([
    ["AI002", 409, "invitation_revoked"],
    ["AI003", 409, "already_filed"],
    ["AI009", 409, "part_one_not_begun"],
    ["23505", 400, "invalid_request"],
  ])("answers the function's %s as %i %s, and audits nothing", async (fnCode, httpStatus, answer) => {
    const rec = seed({ rpc: { record_applicant_intake: { error: { code: fnCode, message: "refused" } } } });
    holder.client = rec.client;
    const res = await correct();
    expect(res.status).toBe(httpStatus);
    expect(await code(res)).toBe(answer);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  /** The applicant's own statements are not the office's to type (the contract's header). */
  it("refuses a §40.25(j) answer, a licence with no expiry, and a partial set", async () => {
    for (const body of [
      { ...CORRECTION, prior_positive_2y: false },
      { ...CORRECTION, licences: [{ state_code: "IL", licence_number: "D1" }] },
      { phone: CORRECTION.phone },
      { ...CORRECTION, licences: [] },
    ]) {
      const rec = seed();
      holder.client = rec.client;
      expect((await correct("recruiter", body)).status).toBe(400);
      expect(rec.rpcs()).toEqual([]);
    }
  });

  it("refuses a reader, a role outside the section, and the unauthenticated", async () => {
    for (const token of ["auditor", "dispatcher"]) {
      const rec = seed();
      holder.client = rec.client;
      expect((await correct(token)).status, token).toBe(403);
      expect(rec.rpcs(), token).toEqual([]);
    }
    expect((await correct(null)).status).toBe(401);
  });
});

/**
 * ⚠ Found building Q-AW36: on a v2 link the identity correction wrote `drivers` and the draft and
 * left Part 1's list holding the OLD licence at position 0 — the list the MVR checklist picks the state
 * from, and the one the drawer shows. Now the list moves with it.
 */
describe("the identity correction on a v2 link", () => {
  const IDENTITY = { date_of_birth: "1980-04-01", cdl_number: "PA334554", cdl_state: "PA" };
  const identity = (rec: SupabaseRecorder) => {
    holder.client = rec.client;
    return office(`/applications/${INV}/identity`, "recruiter", IDENTITY);
  };

  it("replaces the current licence in Part 1's list, keeps the rest, and writes the date of birth", async () => {
    const rec = seed();
    expect((await identity(rec)).status).toBe(200);
    const args = intakeCall(rec)!;
    expect(args).toMatchObject({ p_overwrite: true, p_intake: { date_of_birth: "1980-04-01" } });
    expect(args.p_licences).toEqual([
      // Number and state corrected; its expiry is Part 1's and stays.
      { position: 0, state_code: "PA", agency: null, licence_number: "PA334554", expires_on: "2028-05-01", source: "intake" },
      { position: 1, state_code: "OH", agency: null, licence_number: "OH-1", expires_on: "2020-01-31", source: "intake" },
    ]);
    expect(rec.rpcs().some((r) => r.fn === "record_applicant_identity")).toBe(false);
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "application_identity_corrected", entity_id: INV });
    expectOrgScoped(rec, ORG);
  });

  it("keeps the identity writer on a legacy link", async () => {
    const rec = seed({ intake: false });
    expect((await identity(rec)).status).toBe(200);
    expect(rec.rpcs().map((r) => r.fn)).toEqual(["record_applicant_identity"]);
  });

  /** No list yet: the applicant's first write is fill-only and keeps the office's value on `drivers`. */
  it("keeps the identity writer on a v2 link with no licence on file yet", async () => {
    const rec = seed({ licences: [] });
    expect((await identity(rec)).status).toBe(200);
    expect(rec.rpcs().map((r) => r.fn)).toEqual(["record_applicant_identity"]);
  });

  it("answers a refusal from the intake writer, and audits nothing", async () => {
    const rec = seed({ rpc: { record_applicant_intake: { error: { code: "AI003", message: "refused" } } } });
    const res = await identity(rec);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("already_filed");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});
