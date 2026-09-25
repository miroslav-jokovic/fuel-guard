import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ROAD_TEST_ITEM_KEYS, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The road test (D2) through its HTTP door — `ROAD-TEST-PLAN.md` RT3.
 *
 * ⚠ The fixtures are `postgrestFixture`, which applies the service's own filters, so a read that
 * dropped its `org_id` or `retired_at` filter would pick up the OTHER org's rows seeded below and
 * change an answer. A flat array would have hidden that (`supabase-recorder-does-not-filter`).
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const EXAMINER = "44444444-5555-4666-8777-888888888888";
const RETIRED = "44444444-5555-4666-8777-000000000000";
const TRUCK = "55555555-6666-4777-8888-999999999999";
const FOREIGN_TRUCK = "55555555-6666-4777-8888-000000000000";

const ctx = (role: string): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = { admin: ctx("admin"), recruiter: ctx("recruiter"), dispatcher: ctx("dispatcher") };

let server: Server;
let baseUrl: string;

const post = (path: string, token: string, body: unknown = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

/** A real 1×1 PNG, so the magic-number check has something true to pass. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const allItems = (rating = "satisfactory") => Object.fromEntries(ROAD_TEST_ITEM_KEYS.map((k) => [k, rating]));
const TEST = {
  examiner_id: EXAMINER, vehicle_id: TRUCK, trailer_type: "reefer", tested_on: "2026-09-20", miles: 15,
  items: allItems(), general_performance: "satisfactory", remarks: null, qualified_for: "Tractor-trailer",
};

const seed = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: postgrestFixture([
        { id: DRIVER, org_id: ORG, full_name: "Marko Petrović", phone: null, city: "Chicago", state: "IL",
          postal_code: "60639", cdl_number: "P123", cdl_state: "IL" },
      ]),
      vehicles: postgrestFixture([
        { id: TRUCK, org_id: ORG, unit_number: "1432", make: "FRHT", year: 2024 },
        { id: FOREIGN_TRUCK, org_id: OTHER, unit_number: "9", make: "FRHT", year: 2021 },
      ]),
      road_test_examiners: postgrestFixture([
        { id: EXAMINER, org_id: ORG, full_name: "Arvidera Gakhal", title: "Maintenance manager",
          signature_path: `${ORG}/examiners/a.png`, retired_at: null, created_at: "2026-09-25T00:00:00Z" },
        { id: RETIRED, org_id: ORG, full_name: "Former", title: "Trainer",
          signature_path: `${ORG}/examiners/b.png`, retired_at: "2026-09-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
      ]),
      organizations: [{ name: "Silvicom Inc", legal_address: "1301 Armitage Ave, Melrose Park, IL 60160" }],
      application_invitations: postgrestFixture([]),
      application_drafts: postgrestFixture([]),
      user_profiles: postgrestFixture([{ user_id: "u-recruiter", full_name: "Rita Recruiter" }]),
      documents: postgrestFixture([]),
      qualification_records: [],
      audit_logs: [],
    },
    // A signature download that finds nothing: the renderer prints the typed name instead.
    storage: { download: () => ({ data: null, error: { message: "not found" } }) },
  });

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

describe("adding the examiner's signature (Q-RT2)", () => {
  it("stores it in the carrier's own folder and audits who added it, never the image", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post("/road-test-examiners", "recruiter", { full_name: "Arvidera Gakhal", title: "Maintenance manager", signature_png: PNG });
    expect(res.status).toBe(201);
    const [row] = rec.writtenRows("road_test_examiners");
    expect(row).toMatchObject({ org_id: ORG, full_name: "Arvidera Gakhal", title: "Maintenance manager", created_by: "u-recruiter" });
    expect(String(row!.signature_path)).toMatch(new RegExp(`^${ORG}/examiners/.+\\.png$`));
    const upload = rec.storageCalls().find((c) => c.fn === "upload")!;
    expect(upload.args[0]).toBe(row!.signature_path);
    const [audit] = rec.writtenRows("audit_logs");
    expect(audit).toMatchObject({ action: "compliance.road_test_examiner_added" });
    expect(JSON.stringify(audit)).not.toContain("base64");
  });

  it("refuses bytes that are not a PNG, however the data URL is labelled", async () => {
    holder.client = seed().client;
    const fake = `data:image/png;base64,${Buffer.from("not a png at all").toString("base64")}`;
    const res = await post("/road-test-examiners", "admin", { full_name: "A B", title: "T T", signature_png: fake });
    expect(res.status).toBe(400);
  });

  it("refuses a role that does not manage recruitment", async () => {
    holder.client = seed().client;
    const res = await post("/road-test-examiners", "dispatcher", { full_name: "A B", title: "T T", signature_png: PNG });
    expect(res.status).toBe(403);
  });
});

describe("recording a road test", () => {
  it("files the form AND the certificate on a pass, and the record cites the certificate", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post(`/applicants/${DRIVER}/road-test`, "recruiter", TEST);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { passed: boolean; formDocumentId: string; certificateDocumentId: string };
    expect(body.passed).toBe(true);
    const docs = rec.writtenRows("documents");
    expect(docs.map((d) => d.kind)).toEqual(["road_test", "road_test"]);
    const [record] = rec.writtenRows("qualification_records");
    expect(record).toMatchObject({ kind: "road_test", driver_id: DRIVER, occurred_on: "2026-09-20", document_id: body.certificateDocumentId });
    // Q-RT2: the examiner AND who applied their signature, both on the row.
    expect(record!.detail).toMatchObject({ examiner_id: EXAMINER, recorded_by: "u-recruiter", form_document_id: body.formDocumentId });
    expect(rec.writtenRows("audit_logs")[0]).toMatchObject({ action: "compliance.road_test_recorded" });
    // `organizations` is keyed by the org's OWN id (the letterhead), and `user_profiles` by the user —
    // a display name belongs to the person, not the tenant (D-MEM1). Neither has an org to filter on.
    expectOrgScoped(rec, ORG, { exempt: ["organizations", "user_profiles"] });
  });

  it("files only the form, and nothing the checklist counts, when any item is not Satisfactory", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post(`/applicants/${DRIVER}/road-test`, "admin", {
      ...TEST, items: { ...allItems(), coupling_uncoupling: "needs_training" },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { passed: boolean }).passed).toBe(false);
    expect(rec.writtenRows("documents")).toHaveLength(1);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("refuses a test with an item left unrated — the form would read it as not tested", async () => {
    holder.client = seed().client;
    const items = allItems();
    delete (items as Record<string, string>).pretrip_inspection;
    const res = await post(`/applicants/${DRIVER}/road-test`, "admin", { ...TEST, items });
    expect(res.status).toBe(400);
  });

  it("refuses another carrier's truck, and a retired examiner", async () => {
    holder.client = seed().client;
    expect((await post(`/applicants/${DRIVER}/road-test`, "admin", { ...TEST, vehicle_id: FOREIGN_TRUCK })).status).toBe(400);
    holder.client = seed().client;
    expect((await post(`/applicants/${DRIVER}/road-test`, "admin", { ...TEST, examiner_id: RETIRED })).status).toBe(400);
  });

  it("refuses a date in the future", async () => {
    holder.client = seed().client;
    expect((await post(`/applicants/${DRIVER}/road-test`, "admin", { ...TEST, tested_on: "2999-01-01" })).status).toBe(400);
  });
});

describe("retiring an examiner", () => {
  it("stamps who retired them, scoped to the org, and audits it", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post(`/road-test-examiners/${EXAMINER}/retire`, "admin");
    expect(res.status).toBe(200);
    expect(rec.writtenRows("road_test_examiners")[0]).toMatchObject({ retired_by: "u-admin" });
    expectOrgScoped(rec, ORG);
  });
});
