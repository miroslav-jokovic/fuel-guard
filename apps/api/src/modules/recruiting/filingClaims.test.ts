import { describe, expect, it } from "vitest";
import { ROAD_TEST_ITEM_KEYS } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { countersignHandbook, isHandbookError } from "./handbookSigning.js";
import { HANDBOOK_VERSION } from "./applicationPdf/handbook/handbookText.js";
import { recordRoadTest } from "./roadTest.js";

/**
 * A-10 (C2c): a filing that is pressed twice files once. The handbook claims
 * `handbook_filing_claimed_at` before it files anything; the road test records its invitation and
 * refuses a second pass on it before anything is filed. Both answer 0376's unique indexes in words.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const REP = "11111111-2222-4333-8444-555555555555";
const EXAMINER = "44444444-5555-4666-8777-888888888888";
const TRUCK = "55555555-6666-4777-8888-999999999999";
const DUPLICATE = { code: "23505", message: "duplicate key value violates unique constraint" };

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const claimWrites = (rec: ReturnType<typeof createSupabaseRecorder>) =>
  rec.writtenRows("application_invitations").filter((r) => "handbook_filing_claimed_at" in r);

describe("the handbook countersign claims before it files", () => {
  const seed = (over: { claimWon?: boolean; upload?: boolean; recordError?: unknown } = {}) =>
    createSupabaseRecorder({
      tables: {
        application_invitations: (q: RecordedQuery) => {
          // The claim is a conditional UPDATE: losing it is an update that matched no row.
          if (q.write?.method === "update" && over.claimWon === false) return [];
          return [{
            id: "inv-1", submitted_at: "2026-09-25T10:00:00Z", signing_opened_at: "2026-09-25T09:00:00Z",
            handbook_filed_at: null, expires_at: "2099-01-01T00:00:00.000Z",
          }];
        },
        handbook_marks: (q: RecordedQuery) => (q.write ? [] : ["h1", "h2", "h3", "h4", "h5"].map((placement_id) => ({
          placement_id, signed_name: "Jovana Petrović", signed_at: "2026-09-25T11:05:00Z", representative_id: null,
          handbook_version: HANDBOOK_VERSION,
        }))),
        carrier_representatives: [{ id: REP, full_name: "Miroslav Jokovic", title: "Safety manager", signature_path: `${ORG}/representatives/r.png` }],
        drivers: [{ full_name: "Jovana Petrović" }],
        driver_applications: [{ ssn_last4: "1234" }],
        organizations: [{ name: "Silvicom Inc", legal_address: null }],
        application_captures: [], memberships: [], user_profiles: [], documents: [],
        qualification_records: over.recordError ? { writeError: over.recordError } : [],
      },
      storage: {
        download: async () => ({ data: null, error: { message: "none" } }),
        upload: async () => (over.upload === false ? { data: null, error: { message: "down" } } : { data: {}, error: null }),
      },
    });

  it("files nothing when another press holds the claim", async () => {
    const rec = seed({ claimWon: false });
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result) && result.code).toBe("filing_in_progress");
    expect(rec.writtenRows("handbook_marks")).toHaveLength(0);
    expect(rec.writtenRows("documents")).toHaveLength(0);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("takes only a free or stale claim, on this org's unfiled invitation", async () => {
    const rec = seed();
    await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    const claim = rec.forTable("application_invitations").find((q) => q.write && "handbook_filing_claimed_at" in (q.write.payload as object))!;
    const ops = claim.ops.map((o) => `${o.method}(${o.args.map(String).join(",")})`);
    expect(ops).toContain("is(handbook_filed_at,null)");
    expect(ops.find((o) => o.startsWith("or("))).toMatch(/^or\(handbook_filing_claimed_at\.is\.null,handbook_filing_claimed_at\.lt\.2\d{3}-/);
    expectOrgScoped(rec, ORG, { exempt: ["organizations", "memberships", "user_profiles"] });
  });

  it("hands its claim back when the filing fails, so the next press can file", async () => {
    const rec = seed({ upload: false });
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result) && result.code).toBe("storage_failed");
    const [taken, released] = claimWrites(rec);
    expect(typeof taken!.handbook_filing_claimed_at).toBe("string");
    expect(released).toEqual({ handbook_filing_claimed_at: null });
    const release = rec.forTable("application_invitations").filter((q) => q.write).at(-1)!;
    expect(release.filters()).toContainEqual({ col: "handbook_filing_claimed_at", val: taken!.handbook_filing_claimed_at });
  });

  it("answers the database's one-record index as already filed", async () => {
    const result = await countersignHandbook(seed({ recordError: DUPLICATE }).client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result) && result.code).toBe("already_filed");
  });
});

describe("the road test records its invitation and files a pass once", () => {
  const TEST = {
    examiner_id: EXAMINER, vehicle_id: TRUCK, trailer_type: "reefer", tested_on: "2026-09-20", miles: 15,
    items: Object.fromEntries(ROAD_TEST_ITEM_KEYS.map((k) => [k, "satisfactory"])),
    general_performance: "satisfactory", remarks: null, qualified_for: "Tractor-trailer",
  } as unknown as Parameters<typeof recordRoadTest>[5];

  const seed = (over: { invitation?: boolean; records?: unknown[]; recordError?: unknown } = {}) =>
    createSupabaseRecorder({
      tables: {
        drivers: postgrestFixture([{ id: DRIVER, org_id: ORG, full_name: "Marko Petrović", phone: null, city: "Chicago",
          state: "IL", postal_code: "60639", cdl_number: "P123", cdl_state: "IL" }]),
        vehicles: postgrestFixture([{ id: TRUCK, org_id: ORG, unit_number: "1432", make: "FRHT", year: 2024 }]),
        road_test_examiners: postgrestFixture([{ id: EXAMINER, org_id: ORG, full_name: "Arvidera Gakhal", title: "Maintenance manager",
          signature_path: `${ORG}/examiners/a.png`, retired_at: null }]),
        organizations: [{ name: "Silvicom Inc", legal_address: null }],
        application_invitations: postgrestFixture(over.invitation === false ? [] : [
          { id: "inv-1", org_id: ORG, driver_id: DRIVER, revoked_at: null, created_at: "2026-09-01T00:00:00Z" },
        ]),
        application_drafts: postgrestFixture([]),
        user_profiles: postgrestFixture([]),
        documents: postgrestFixture([]),
        qualification_records: over.recordError
          ? { writeError: over.recordError }
          : postgrestFixture((over.records ?? []) as Record<string, unknown>[]),
      },
      storage: { download: () => ({ data: new Blob([PNG], { type: "image/png" }), error: null }) },
    });

  const pass = (orgId: string, invitationId: string, source = "road_test") => ({
    id: `qr-${orgId.slice(0, 4)}-${invitationId}`, org_id: orgId, driver_id: DRIVER, kind: "road_test",
    detail: { source, invitation_id: invitationId },
  });

  it("writes the live invitation onto the pass it records", async () => {
    const rec = seed();
    const result = await recordRoadTest(rec.client, ORG, "u-1", "admin", DRIVER, TEST, "2026-09-20");
    expect("recordId" in result && result.recordId).toBeTruthy();
    expect(rec.writtenRows("qualification_records")[0]!.detail).toMatchObject({ source: "road_test", invitation_id: "inv-1" });
  });

  it("refuses a second pass on the same invitation before filing any document", async () => {
    const rec = seed({ records: [pass(ORG, "inv-1")] });
    const result = await recordRoadTest(rec.client, ORG, "u-1", "admin", DRIVER, TEST, "2026-09-20");
    expect("code" in result && result.code).toBe("already_passed");
    expect(rec.writtenRows("documents")).toHaveLength(0);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("is not stopped by a pass on another invitation, another org, or the generic DQ door", async () => {
    const rec = seed({ records: [pass(ORG, "inv-0"), pass(OTHER, "inv-1"), pass(ORG, "inv-1", "dq")] });
    const result = await recordRoadTest(rec.client, ORG, "u-1", "admin", DRIVER, TEST, "2026-09-20");
    expect("recordId" in result && result.recordId).toBeTruthy();
  });

  it("answers the database's one-pass index as already passed", async () => {
    const result = await recordRoadTest(seed({ recordError: DUPLICATE }).client, ORG, "u-1", "admin", DRIVER, TEST, "2026-09-20");
    expect("code" in result && result.code).toBe("already_passed");
  });

  it("records a driver with no invitation exactly as before", async () => {
    const rec = seed({ invitation: false });
    await recordRoadTest(rec.client, ORG, "u-1", "admin", DRIVER, TEST, "2026-09-20");
    expect(rec.writtenRows("qualification_records")[0]!.detail).not.toHaveProperty("invitation_id");
  });
});
