import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { countersignHandbook, driverHandbookStatus, handbookLinkExpiry, isHandbookError, openHandbookSigning } from "./handbookSigning.js";
import { HANDBOOK_VERSION } from "./applicationPdf/handbook/handbookText.js";

/**
 * The office's half of the handbook (HANDBOOK-SIGNING-PLAN.md HB3): open it at the desk, then
 * countersign and file it once the driver has signed their five places.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const REP = "11111111-2222-4333-8444-555555555555";
const OTHER_REP = "22222222-3333-4444-8555-666666666666";
const DRIVER_PLACES = ["h1", "h2", "h3", "h4", "h5"];

const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", submitted_at: "2026-09-25T10:00:00Z", handbook_signing_opened_at: "2026-09-25T11:00:00Z", handbook_filed_at: null,
  // Far enough out that no press in these tests needs to extend it, unless a test says otherwise.
  expires_at: "2099-01-01T00:00:00.000Z", ...over,
});

const filterOf = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;

const seed = (over: { invitation?: Record<string, unknown> | null; places?: string[]; carrierMarkError?: unknown; rep?: boolean } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [invitation(over.invitation)],
      handbook_marks: (q: RecordedQuery) => {
        if (q.write) return over.carrierMarkError ? { writeError: over.carrierMarkError } : [];
        return (over.places ?? DRIVER_PLACES).map((placement_id) => ({
          placement_id, signed_name: "Jovana Petrović", signed_at: "2026-09-25T11:05:00Z", representative_id: placement_id === "h4c" ? REP : null,
        }));
      },
      carrier_representatives: (q: RecordedQuery) => {
        if (over.rep === false) return [];
        const id = filterOf(q, "id");
        if (id === REP) return [{ id: REP, full_name: "Miroslav Jokovic", title: "Safety manager", signature_path: `${ORG}/representatives/r.png` }];
        if (id === OTHER_REP) return [{ id: OTHER_REP, full_name: "Somebody Else", title: "Owner", signature_path: `${ORG}/representatives/o.png` }];
        return [];
      },
      drivers: [{ full_name: "Jovana Petrović-Szczepańska" }],
      driver_applications: [{ ssn_last4: "1234" }],
      organizations: [{ name: "Silvicom Inc", legal_address: null }],
      application_captures: [],
      memberships: [],
      user_profiles: [],
      documents: [],
      qualification_records: [],
    },
    storage: {
      download: async () => ({ data: null, error: { message: "none" } }),
      upload: async () => ({ data: {}, error: null }),
    },
  });

describe("opening handbook signing", () => {
  it("refuses before the application is filed (D-HB1: the handbook comes after it)", async () => {
    const rec = seed({ invitation: { submitted_at: null, handbook_signing_opened_at: null } });
    const result = await openHandbookSigning(rec.client, ORG, "u-1", DRIVER);
    expect(isHandbookError(result) && result.code).toBe("application_not_filed");
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("stamps who opened it, once", async () => {
    const rec = seed({ invitation: { handbook_signing_opened_at: null } });
    const result = await openHandbookSigning(rec.client, ORG, "u-1", DRIVER);
    expect(isHandbookError(result)).toBe(false);
    const write = rec.writtenRows("application_invitations")[0]!;
    expect(write.handbook_signing_opened_by).toBe("u-1");
    expect(typeof write.handbook_signing_opened_at).toBe("string");
    expectOrgScoped(rec, ORG);
  });

  it("is idempotent: a second press on a long-lived link changes nothing", async () => {
    const rec = seed();
    const result = await openHandbookSigning(rec.client, ORG, "u-1", DRIVER);
    expect(!isHandbookError(result) && result.openedAt).toBe("2026-09-25T11:00:00Z");
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });
});

describe("keeping the driver's link alive (APPLICATION-FLOW-V2-PLAN.md A-2)", () => {
  const NOW = new Date("2026-09-26T17:00:00.000Z");
  const FOURTEEN_DAYS_ON = "2026-10-10T17:00:00.000Z";

  it("extends an already-opened, unfiled handbook's link, and never re-stamps who opened it", async () => {
    // d61557dc's shape on 2026-09-26: filed, opened 09-25 20:08, link lapsing 09-28 18:00 UTC.
    const rec = seed({ invitation: { handbook_signing_opened_at: "2026-09-25T20:08:00Z", expires_at: "2026-09-28T18:00:00.000Z" } });
    const result = await openHandbookSigning(rec.client, ORG, "u-2", DRIVER, NOW);
    expect(result).toEqual({ invitationId: "inv-1", openedAt: "2026-09-25T20:08:00Z", expiresAt: FOURTEEN_DAYS_ON, extended: true });
    const writes = rec.writtenRows("application_invitations");
    expect(writes).toEqual([{ expires_at: FOURTEEN_DAYS_ON }]);
    expectOrgScoped(rec, ORG);
  });

  it("revives a link that has already lapsed", async () => {
    const rec = seed({ invitation: { expires_at: "2026-09-20T00:00:00.000Z" } });
    const result = await openHandbookSigning(rec.client, ORG, "u-1", DRIVER, NOW);
    expect(!isHandbookError(result) && result.expiresAt).toBe(FOURTEEN_DAYS_ON);
  });

  it("extends and stamps on the first press", async () => {
    const rec = seed({ invitation: { handbook_signing_opened_at: null, expires_at: "2026-09-28T18:00:00.000Z" } });
    const result = await openHandbookSigning(rec.client, ORG, "u-1", DRIVER, NOW);
    expect(!isHandbookError(result) && result.extended).toBe(true);
    const writes = rec.writtenRows("application_invitations");
    expect(writes[0]).toEqual({ expires_at: FOURTEEN_DAYS_ON });
    expect(writes[1]).toMatchObject({ handbook_signing_opened_by: "u-1", handbook_signing_opened_at: NOW.toISOString() });
    expectOrgScoped(rec, ORG);
  });

  it("never shortens a link, and never extends a filed or unfiled-application one", async () => {
    expect(handbookLinkExpiry("2026-10-30T00:00:00.000Z", NOW)).toBeNull();
    expect(handbookLinkExpiry(FOURTEEN_DAYS_ON, NOW)).toBeNull();
    expect(handbookLinkExpiry("2026-10-10T16:59:59.999Z", NOW)).toBe(FOURTEEN_DAYS_ON);

    const filed = seed({ invitation: { handbook_filed_at: "2026-09-25T12:00:00Z", expires_at: "2026-09-27T00:00:00.000Z" } });
    expect(isHandbookError(await openHandbookSigning(filed.client, ORG, "u", DRIVER, NOW))).toBe(true);
    expect(filed.writtenRows("application_invitations")).toHaveLength(0);
    const unfiled = seed({ invitation: { submitted_at: null, handbook_signing_opened_at: null, expires_at: "2026-09-27T00:00:00.000Z" } });
    expect(isHandbookError(await openHandbookSigning(unfiled.client, ORG, "u", DRIVER, NOW))).toBe(true);
    expect(unfiled.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("shows the office when the link lapses", async () => {
    const result = await driverHandbookStatus(seed({ invitation: { expires_at: "2026-09-28T18:00:00.000Z" } }).client, ORG, DRIVER);
    expect(!isHandbookError(result) && result.linkExpiresAt).toBe("2026-09-28T18:00:00.000Z");
  });
});

describe("countersigning and filing", () => {
  it("answers link_expired, not insert_failed, when 0374 refuses the carrier's mark on a lapsed link (HB021)", async () => {
    const rec = seed({ carrierMarkError: { code: "HB021", message: "handbook_invitation_unusable" } });
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result) && result.code).toBe("link_expired");
    expect(rec.writtenRows("documents")).toHaveLength(0);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("refuses while a driver place is unsigned: the carrier does not agree with itself", async () => {
    const rec = seed({ places: ["h1", "h2", "h3", "h4"] });
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result) && result.code).toBe("driver_not_finished");
    expect(rec.writtenRows("handbook_marks")).toHaveLength(0);
  });

  it("refuses before signing was opened, and after it was filed", async () => {
    const closed = await countersignHandbook(seed({ invitation: { handbook_signing_opened_at: null } }).client, ORG, "u", null, DRIVER, REP);
    expect(isHandbookError(closed) && closed.code).toBe("not_opened");
    const filed = await countersignHandbook(seed({ invitation: { handbook_filed_at: "2026-09-25T12:00:00Z" } }).client, ORG, "u", null, DRIVER, REP);
    expect(isHandbookError(filed) && filed.code).toBe("already_filed");
  });

  it("refuses a representative this carrier does not have", async () => {
    const rec = seed({ rep: false });
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result) && result.code).toBe("representative_not_found");
  });

  it("records the carrier's place with the Representative AND the office user, files the PDF, the record, and the stamp", async () => {
    const rec = seed();
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result)).toBe(false);

    const mark = rec.writtenRows("handbook_marks")[0]!;
    expect(mark).toMatchObject({ placement_id: "h4c", party: "carrier", representative_id: REP, recorded_by: "u-1", handbook_version: HANDBOOK_VERSION });

    const doc = rec.writtenRows("documents")[0]!;
    expect(doc).toMatchObject({ kind: "handbook", subject_type: "driver", subject_id: DRIVER, content_type: "application/pdf" });

    const record = rec.writtenRows("qualification_records")[0]!;
    expect(record).toMatchObject({ kind: "handbook", driver_id: DRIVER, document_id: doc.id, reference: HANDBOOK_VERSION });
    expect(record.detail).toMatchObject({ invitation_id: "inv-1", representative_id: REP, recorded_by: "u-1" });

    const stamp = rec.writtenRows("application_invitations")[0]!;
    expect(typeof stamp.handbook_filed_at).toBe("string");
    expectOrgScoped(rec, ORG, { exempt: ["organizations", "memberships", "user_profiles"] });
  });

  it("resumes a countersignature whose filing failed, keeping the Representative it recorded", async () => {
    // The carrier place already holds REP from the earlier press. The retry asks for OTHER_REP, and
    // the filed record must still name REP — the place is signed, and by whom is already a fact.
    const rec = seed({ places: [...DRIVER_PLACES, "h4c"], carrierMarkError: { code: "23505", message: "duplicate" } });
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, OTHER_REP);
    expect(isHandbookError(result)).toBe(false);
    expect(rec.writtenRows("qualification_records")[0]!.detail).toMatchObject({ representative_id: REP });
  });
});

describe("the office's view of it", () => {
  it("reports opened, the places signed, and driver-complete", async () => {
    const result = await driverHandbookStatus(seed().client, ORG, DRIVER);
    expect(isHandbookError(result)).toBe(false);
    expect(!isHandbookError(result) && result.driverComplete).toBe(true);
    expect(!isHandbookError(result) && result.openedAt).toBe("2026-09-25T11:00:00Z");
  });
});
