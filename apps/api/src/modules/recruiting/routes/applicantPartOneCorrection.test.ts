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
  /** F3: what Part 1 and `drivers` held before the correction, and packet marks made. */
  stored?: Record<string, unknown>;
  driver?: Record<string, unknown>;
  marks?: number;
  draft?: Record<string, unknown> | null;
  edits?: unknown;
} = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [{
        id: INV, org_id: ORG, driver_id: DRIVER, submitted_at: null, ...over.invitation,
      }],
      application_intakes: over.intake === false ? [] : [{ id: "intake-1", invitation_id: INV, ...over.stored }],
      application_intake_licences: over.licences ?? STORED_LICENCES,
      drivers: [{ id: DRIVER, org_id: ORG, date_of_birth: null, cdl_number: null, cdl_state: null, ...over.driver }],
      application_packet_marks: { data: [], count: over.marks ?? 0 },
      application_drafts: over.draft ? [{ invitation_id: INV, payload: over.draft, revision: 3 }] : [],
      application_edits: (over.edits ?? []) as never,
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

  /** §9 P5: the office corrects until filing — the line the draft's own corrections stop at too. */
  it("refuses once the application is filed, writing nothing", async () => {
    const rec = seed({ invitation: { submitted_at: "2026-09-27T10:00:00Z" } });
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

/**
 * F3 (E7): every change the office makes reaches the driver's signing screen as an `application_edits`
 * row, and none lands once the driver has started marking the packet.
 */
describe("every office correction is shown to the driver, and none lands once they are signing", () => {
  const STORED = {
    phone: "+17082365732", address_line1: "9 Old Rd", address_line2: null, city: "Joliet",
    state: "IL", postal_code: "60432", prior_positive_2y: false,
  };
  /** The current home is the SECOND address, so the row's index is read from the draft, not assumed. */
  const DRAFT = { addresses: [{ line1: "1 A St", from: "2019-01", to: "2022-12" }, { line1: "", from: "2023-01", to: null }] };
  const editRows = (rec: SupabaseRecorder) =>
    rec.writtenRows("application_edits").map((r) => {
      const row = r as Record<string, unknown>;
      return { path: row.path, before: row.before, after: row.after };
    });

  it("writes one row per Part 1 change, addressed where the application files it", async () => {
    const rec = seed({ stored: STORED, driver: { cdl_class: "B" }, draft: DRAFT });
    holder.client = rec.client;
    expect((await correct()).status).toBe(200);
    expect(editRows(rec)).toEqual([
      { path: ["addresses", 1, "line1"], before: "9 Old Rd", after: "12 Depot Rd" },
      { path: ["cdl_class"], before: "B", after: "A" },
      { path: ["cdl_state"], before: "PA", after: "IL" },
      { path: ["cdl_number"], before: "PA-OLD", after: "D123-4567" },
      { path: ["cdl_expires_at"], before: "2028-05-01", after: "2029-01-01" },
      {
        path: ["additional_licences", 0],
        before: { issuing_authority: "OH", number: "OH-1", expires_at: "2020-01-31" },
        after: { issuing_authority: "Indiana BMV", number: "IN-555", expires_at: "2021-06-30" },
      },
    ]);
    const [row] = rec.writtenRows("application_edits") as Array<Record<string, unknown>>;
    expect(row).toMatchObject({ org_id: ORG, invitation_id: INV, edited_by: "u-recruiter" });
    expectOrgScoped(rec, ORG);
  });

  /** F3c part 2 (E2): one licence taken out of the middle is ONE line on 3.1, not a shift of the rest. */
  it("logs a licence removed from the middle of Part 1's list as one removal row", async () => {
    const three = [
      { invitation_id: INV, position: 0, state_code: "IL", agency: null, licence_number: "D123-4567", expires_on: "2029-01-01" },
      { invitation_id: INV, position: 1, state_code: "OH", agency: null, licence_number: "OH-1", expires_on: "2020-01-31" },
      { invitation_id: INV, position: 2, state_code: "IN", agency: "Indiana BMV", licence_number: "IN-555", expires_on: "2021-06-30" },
    ];
    const rec = seed({ stored: STORED, licences: three, draft: DRAFT });
    holder.client = rec.client;
    expect((await correct()).status).toBe(200);
    const licenceRows = rec.writtenRows("application_edits")
      .map((r) => r as Record<string, unknown>)
      .filter((row) => (row.path as unknown[])[0] === "additional_licences")
      .map((row) => ({ path: row.path, before: row.before, after: row.after }));
    expect(licenceRows).toEqual([
      { path: ["additional_licences", 0], before: { issuing_authority: "OH", number: "OH-1", expires_at: "2020-01-31" }, after: null },
    ]);
  });

  it("refuses a Part 1 correction once the driver has marked the packet, writing nothing", async () => {
    const rec = seed({ stored: STORED, marks: 1 });
    holder.client = rec.client;
    const res = await correct();
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_editable");
    expect(rec.rpcs()).toEqual([]);
    expect(rec.writes()).toHaveLength(0);
  });

  const IDENTITY = { date_of_birth: "1980-04-01", cdl_number: "PA334554", cdl_state: "PA" };
  const identity = (rec: SupabaseRecorder) => {
    holder.client = rec.client;
    return office(`/applications/${INV}/identity`, "recruiter", IDENTITY);
  };

  it("writes a row for each identity value that changed, on a v2 link", async () => {
    const rec = seed({ driver: { date_of_birth: "1980-01-04", cdl_number: "PA334554", cdl_state: "PA" } });
    expect((await identity(rec)).status).toBe(200);
    // The licence did not change, so only the date of birth is shown to the driver.
    expect(editRows(rec)).toEqual([{ path: ["date_of_birth"], before: "1980-01-04", after: "1980-04-01" }]);
  });

  it("writes the rows on a legacy link too, where the identity writer carries it", async () => {
    const rec = seed({ intake: false, driver: { date_of_birth: "1980-01-04", cdl_number: "X1", cdl_state: "IL" } });
    expect((await identity(rec)).status).toBe(200);
    expect(editRows(rec).map((r) => r.path)).toEqual([["date_of_birth"], ["cdl_number"], ["cdl_state"]]);
  });

  it("refuses an identity correction once the driver has marked the packet, writing nothing", async () => {
    const rec = seed({ marks: 2 });
    const res = await identity(rec);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_editable");
    expect(rec.rpcs()).toEqual([]);
    expect(rec.writes()).toHaveLength(0);
  });

  it("says so when the change was made but the driver's record of it could not be written", async () => {
    const rec = seed({ stored: STORED, draft: DRAFT, edits: { data: [], writeError: { message: "down" } } });
    holder.client = rec.client;
    const res = await correct();
    expect(res.status).not.toBe(200);
    expect(await code(res)).toBe("edit_not_recorded");
  });
});
