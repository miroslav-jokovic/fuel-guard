import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The office correcting ONE Part 1 answer (F3, the owner's Q-AM13 ruling): the driver's drug-and-alcohol
 * statements with a reason, medical card pending, endorsements, and the donor gender, blind.
 *
 * ⚠ The recorder executes no SQL, so this pins the TypeScript half: exactly one key reaches
 * `record_applicant_intake`, the licence list and endorsements are left alone unless sent, the edit row
 * is addressed where the driver reads it, a statement carries its note, and the donor gender's row and
 * the review read never carry its value. The function's write-present-keys-only rule is 0376/0469's,
 * pinned against real Postgres in `supabase/tests/application-intake-v2.test.mjs`.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const INV = "11111111-2222-4333-8444-555555555555";

const INTAKE = {
  invitation_id: INV, prior_positive_2y: false, dot_program_30d: true, dot_tested_6m: false, dot_random_12m: true,
  medical_card_pending: false, endorsements: ["N", "H"], donor_gender: "female",
};

const seed = (over: { intake?: Record<string, unknown> | null; marks?: number; submitted?: string | null; edits?: unknown } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{ id: INV, org_id: ORG, driver_id: DRIVER, submitted_at: over.submitted ?? null }],
      application_intakes: over.intake === null ? [] : [{ ...INTAKE, ...over.intake }],
      application_packet_marks: { data: [], count: over.marks ?? 0 },
      application_edits: (over.edits ?? []) as never,
      audit_logs: [],
    },
    rpc: { record_applicant_intake: { intake_id: "intake-1", licence_count: 1, kept_existing: [] } },
  });

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { recruiter: ctx("recruiter"), auditor: ctx("auditor") };

let server: Server;
let baseUrl: string;
const answer = (body: unknown, token = "recruiter") =>
  fetch(`${baseUrl}/api/recruitment/applications/${INV}/part-one/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const code = async (res: Response) => ((await res.json()) as { error?: { code?: string } }).error?.code ?? "";
const intakeCall = (rec: SupabaseRecorder) =>
  rec.rpcs().find((r) => r.fn === "record_applicant_intake")?.args as Record<string, unknown> | undefined;
const editRows = (rec: SupabaseRecorder) => rec.writtenRows("application_edits") as Array<Record<string, unknown>>;

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

describe("the driver's own statements (Q-AM13)", () => {
  it("writes the one key, overwriting, and leaves the licences and endorsements alone", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await answer({ key: "dot_tested_6m", value: true, note: "Driver called: tested in May" })).status).toBe(200);
    expect(intakeCall(rec)).toMatchObject({
      p_org: ORG, p_invitation: INV, p_driver: DRIVER, p_overwrite: true,
      p_intake: { dot_tested_6m: true }, p_licences: null, p_endorsements: null,
    });
    expectOrgScoped(rec, ORG);
  });

  it("records the change with the office's reason, for the driver to read on 3.1", async () => {
    const rec = seed();
    holder.client = rec.client;
    await answer({ key: "dot_tested_6m", value: true, note: "Driver called: tested in May" });
    expect(editRows(rec)).toEqual([expect.objectContaining({
      path: ["dot_tested_6m"], before: false, after: true, note: "Driver called: tested in May", withheld: false,
      org_id: ORG, invitation_id: INV, edited_by: "u-recruiter",
    })]);
  });

  it("files §40.25(j) under the application's own question, where the driver reads it", async () => {
    const rec = seed();
    holder.client = rec.client;
    await answer({ key: "prior_positive_2y", value: true, note: "Corrected on the phone" });
    expect(editRows(rec)[0]).toMatchObject({ path: ["prior_failed_pre_employment_test"], before: false, after: true });
  });

  it("refuses a statement with no reason, and writes nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    for (const note of [undefined, "", "   "]) {
      const res = await answer({ key: "prior_positive_2y", value: true, ...(note === undefined ? {} : { note }) });
      expect(res.status).toBe(400);
    }
    expect(rec.rpcs()).toEqual([]);
  });

  it("audits the act by field name, never the value or the note", async () => {
    const rec = seed();
    holder.client = rec.client;
    await answer({ key: "dot_tested_6m", value: true, note: "Driver called: tested in May" });
    const [audit] = rec.writtenRows("audit_logs");
    expect((audit!.meta as { fields: string[] }).fields).toEqual(["dot_tested_6m"]);
    expect(JSON.stringify(audit)).not.toContain("tested in May");
  });
});

describe("the donor gender is replaced blind (Q-AM13, D-MSUX10)", () => {
  it("writes the new answer and records only THAT it changed", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await answer({ key: "donor_gender", value: "male" })).status).toBe(200);
    expect(intakeCall(rec)!.p_intake).toEqual({ donor_gender: "male" });
    const [row] = editRows(rec);
    expect(row).toMatchObject({ path: ["donor_gender"], before: null, after: null, withheld: true });
    expect(JSON.stringify(row)).not.toMatch(/male|female/);
  });

  it("never sends the answer to the office's review — only whether one was given", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await fetch(`${baseUrl}/api/recruitment/applications/${INV}/review`, { headers: { Authorization: "Bearer recruiter" } });
    const body = (await res.json()) as { partOneAnswers?: Record<string, unknown> };
    expect(body.partOneAnswers).toMatchObject({ donorGenderGiven: true, dot_program_30d: true, endorsements: ["N", "H"] });
    expect(JSON.stringify(body)).not.toContain("female");
  });
});

describe("the other answers", () => {
  it("replaces the endorsements whole through the endorsement list, and logs them sorted", async () => {
    const rec = seed();
    holder.client = rec.client;
    await answer({ key: "endorsements", value: ["T", "H"] });
    expect(intakeCall(rec)).toMatchObject({ p_intake: {}, p_endorsements: ["T", "H"], p_licences: null });
    // F2b: recorded where the application files them, so 3.1 and the card name the same answer.
    expect(editRows(rec)[0]).toMatchObject({ path: ["cdl_endorsements"], before: ["H", "N"], after: ["H", "T"], note: null });
  });

  it("records nothing for an answer that did not change — the driver has nothing to read", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await answer({ key: "medical_card_pending", value: false })).status).toBe(200);
    expect(editRows(rec)).toEqual([]);
  });
});

describe("when it is refused", () => {
  it("once the driver has marked the packet, writing nothing", async () => {
    const rec = seed({ marks: 1 });
    holder.client = rec.client;
    const res = await answer({ key: "medical_card_pending", value: true });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("application_not_editable");
    expect(rec.rpcs()).toEqual([]);
  });

  it("on a legacy link, which has no Part 1", async () => {
    const rec = seed({ intake: null });
    holder.client = rec.client;
    const res = await answer({ key: "medical_card_pending", value: true });
    expect(await code(res)).toBe("not_part_one");
    expect(rec.rpcs()).toEqual([]);
  });

  it("for a reader who may only view", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await answer({ key: "medical_card_pending", value: true }, "auditor")).status).toBe(403);
    expect(rec.rpcs()).toEqual([]);
  });

  it("says so when the change was made but the driver's record of it could not be written", async () => {
    const rec = seed({ edits: { data: [], writeError: { message: "down" } } });
    holder.client = rec.client;
    expect(await code(await answer({ key: "medical_card_pending", value: true }))).toBe("edit_not_recorded");
  });
});
