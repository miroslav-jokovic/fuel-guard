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
const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"), recruiter: ctx("recruiter"), dispatcher: ctx("dispatcher"), fleet_manager: ctx("fleet_manager"),
};

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

const seed = (over: { signatureFile?: boolean; cdlNumber?: string | null } = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: postgrestFixture([
        { id: DRIVER, org_id: ORG, full_name: "Marko Petrović", phone: null, city: "Chicago", state: "IL",
          postal_code: "60639", cdl_number: "cdlNumber" in over ? over.cdlNumber : "P123", cdl_state: "IL" },
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
    // The examiner's signature file, as Storage hands it back; `signatureFile: false` models it missing,
    // which A-12 now refuses rather than printing the typed name in its place.
    storage: {
      download: () =>
        over.signatureFile === false
          ? { data: null, error: { message: "not found" } }
          : { data: new Blob([Buffer.from(PNG.split(",")[1]!, "base64")], { type: "image/png" }), error: null },
    },
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
    const res = await post("/road-test-examiners", "admin", { full_name: "Arvidera Gakhal", title: "Maintenance manager", signature_png: PNG });
    expect(res.status).toBe(201);
    const [row] = rec.writtenRows("road_test_examiners");
    expect(row).toMatchObject({ org_id: ORG, full_name: "Arvidera Gakhal", title: "Maintenance manager", created_by: "u-admin" });
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

  // Q-AW19 (owner, 2026-09-29): "only admin can add". A recruiter and a fleet manager both manage
  // recruiting — which is why the gate is not that section — and a dispatcher manages neither.
  for (const role of ["recruiter", "fleet_manager", "dispatcher"]) {
    it(`refuses a ${role}, writing and storing nothing — only the admin keeps the register`, async () => {
      const rec = seed();
      holder.client = rec.client;
      const res = await post("/road-test-examiners", role, { full_name: "A B", title: "T T", signature_png: PNG });
      expect(res.status).toBe(403);
      expect(rec.writtenRows("road_test_examiners")).toHaveLength(0);
      expect(rec.storageCalls().filter((c) => c.fn === "upload")).toHaveLength(0);
    });
  }
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

  it("refuses, filing nothing, when the examiner's signature file cannot be read (A-12)", async () => {
    const rec = seed({ signatureFile: false });
    holder.client = rec.client;
    const res = await post(`/applicants/${DRIVER}/road-test`, "recruiter", TEST);
    expect(res.status).toBe(400);
    expect(rec.writtenRows("documents")).toHaveLength(0);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("refuses a pass, filing nothing, when the applicant has no licence number for the certificate (A-12)", async () => {
    const rec = seed({ cdlNumber: null });
    holder.client = rec.client;
    const res = await post(`/applicants/${DRIVER}/road-test`, "recruiter", TEST);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("licence number");
    expect(rec.writtenRows("documents")).toHaveLength(0);
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
  for (const role of ["recruiter", "fleet_manager"]) {
    it(`refuses a ${role} — retiring is the admin's too`, async () => {
      const rec = seed();
      holder.client = rec.client;
      expect((await post(`/road-test-examiners/${EXAMINER}/retire`, role)).status).toBe(403);
      expect(rec.writtenRows("road_test_examiners")).toHaveLength(0);
    });
  }

  it("stamps who retired them, scoped to the org, and audits it", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post(`/road-test-examiners/${EXAMINER}/retire`, "admin");
    expect(res.status).toBe(200);
    expect(rec.writtenRows("road_test_examiners")[0]).toMatchObject({ retired_by: "u-admin" });
    expectOrgScoped(rec, ORG);
  });
});

/**
 * G-10 (Q-AW19, owner 2026-09-29): has the driver had their copy of the certificate (§391.31(g))?
 *
 * ⚠ Every fixture below carries a row that must NOT count — another org's audit row naming this very
 * certificate, a handover of a different certificate, a roster-entered road test with no certificate
 * of ours — so a read that lost a filter changes an answer instead of passing on an empty table.
 */
describe("the driver's copy of the certificate (G-10)", () => {
  const CERT = "66666666-7777-4888-8999-aaaaaaaaaaaa";
  const OTHER_CERT = "66666666-7777-4888-8999-bbbbbbbbbbbb";
  const ROSTER_ROW = "66666666-7777-4888-8999-cccccccccccc";
  const NO_DOC = "66666666-7777-4888-8999-dddddddddddd";
  const OTHER_DRIVER = "77777777-8888-4999-8aaa-000000000000";
  const records = [
    { id: CERT, org_id: ORG, driver_id: DRIVER, kind: "road_test", document_id: "d-1", detail: { source: "road_test" } },
    { id: OTHER_CERT, org_id: ORG, driver_id: OTHER_DRIVER, kind: "road_test", document_id: "d-2", detail: { source: "road_test" } },
    // Entered from the compliance page: a road test on file, but no certificate this product issued.
    { id: ROSTER_ROW, org_id: ORG, driver_id: DRIVER, kind: "road_test", document_id: "d-3", detail: {} },
    // Ours, but citing no document — there is nothing to hand over.
    { id: NO_DOC, org_id: ORG, driver_id: DRIVER, kind: "road_test", document_id: null, detail: { source: "road_test" } },
  ];
  const audit = (over: Record<string, unknown>) => ({
    org_id: ORG, entity: "qualification_records", entity_id: CERT, action: "road_test_certificate_downloaded",
    created_at: "2026-09-26T15:00:00Z", ...over,
  });
  const NOISE = [
    audit({ org_id: OTHER, action: "road_test_certificate_handed_over", created_at: "2026-09-20T00:00:00Z" }),
    audit({ entity_id: OTHER_CERT, action: "road_test_certificate_handed_over" }),
    audit({ entity_id: ROSTER_ROW, action: "road_test_certificate_handed_over" }),
  ];
  const copySeed = (auditRows: Record<string, unknown>[], writeFails = false) =>
    createSupabaseRecorder({
      tables: {
        qualification_records: postgrestFixture(records),
        audit_logs: writeFails
          ? (q) => ({ data: postgrestFixture(auditRows)(q), writeError: { message: "down" } })
          : postgrestFixture(auditRows),
      },
    });
  const get = (path: string, token: string) =>
    fetch(`${baseUrl}/api/recruitment${path}`, { headers: { Authorization: `Bearer ${token}` } });

  it("reports a download from the driver's link as a copy given, and nothing that is not this certificate's", async () => {
    const rec = copySeed([...NOISE, audit({}), audit({ created_at: "2026-09-27T09:00:00Z" })]);
    holder.client = rec.client;
    const res = await get(`/applicants/${DRIVER}/road-test/copies`, "recruiter");
    expect(res.status).toBe(200);
    // The FIRST download, and no handover: the other org's handover of this same id did not count.
    expect(((await res.json()) as { copies: unknown[] }).copies).toEqual([
      { recordId: CERT, given: true, downloadedAt: "2026-09-26T15:00:00Z", handedOverAt: null },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("reports a certificate nobody has had as not given", async () => {
    holder.client = copySeed(NOISE).client;
    const body = (await (await get(`/applicants/${DRIVER}/road-test/copies`, "recruiter")).json()) as { copies: unknown[] };
    expect(body.copies).toEqual([{ recordId: CERT, given: false, downloadedAt: null, handedOverAt: null }]);
  });

  it("records the office handing over paper, naming who and which certificate", async () => {
    const rec = copySeed(NOISE);
    holder.client = rec.client;
    const res = await post(`/applicants/${DRIVER}/road-test/${CERT}/paper-copy`, "recruiter");
    expect(res.status).toBe(200);
    const { copy } = (await res.json()) as { copy: { given: boolean; handedOverAt: string | null } };
    expect(copy.given).toBe(true);
    expect(copy.handedOverAt).not.toBeNull();
    expect(rec.writtenRows("audit_logs")).toEqual([
      expect.objectContaining({
        org_id: ORG, actor_id: "u-recruiter", action: "road_test_certificate_handed_over",
        entity: "qualification_records", entity_id: CERT, meta: { driverId: DRIVER, documentId: "d-1" },
      }),
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("writes nothing a second time — the first handover stands", async () => {
    const rec = copySeed([...NOISE, audit({ action: "road_test_certificate_handed_over", created_at: "2026-09-28T10:00:00Z" })]);
    holder.client = rec.client;
    const res = await post(`/applicants/${DRIVER}/road-test/${CERT}/paper-copy`, "admin");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { copy: { handedOverAt: string } }).copy.handedOverAt).toBe("2026-09-28T10:00:00Z");
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });

  it("refuses another driver's certificate, a road test that is not one of ours, and one citing no document", async () => {
    for (const id of [OTHER_CERT, ROSTER_ROW, NO_DOC]) {
      const rec = copySeed(NOISE);
      holder.client = rec.client;
      expect((await post(`/applicants/${DRIVER}/road-test/${id}/paper-copy`, "admin")).status).toBe(404);
      expect(rec.writtenRows("audit_logs")).toHaveLength(0);
    }
  });

  it("answers a failure when the audit row could not be written — it is the whole record", async () => {
    holder.client = copySeed(NOISE, true).client;
    expect((await post(`/applicants/${DRIVER}/road-test/${CERT}/paper-copy`, "recruiter")).status).toBe(500);
  });

  it("refuses a role that does not manage recruitment", async () => {
    const rec = copySeed(NOISE);
    holder.client = rec.client;
    expect((await post(`/applicants/${DRIVER}/road-test/${CERT}/paper-copy`, "dispatcher")).status).toBe(403);
    expect(rec.writtenRows("audit_logs")).toHaveLength(0);
  });
});
