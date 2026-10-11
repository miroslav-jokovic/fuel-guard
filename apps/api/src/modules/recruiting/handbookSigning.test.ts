import { describe, it, expect, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { HANDBOOK_LINK_EXPIRED, countersignHandbook, driverHandbookStatus, handbookLinkExpiry, extendHandbookLink, isHandbookError } from "./handbookSigning.js";
import { countersignPacket } from "./packetCountersign.js";
import { HANDBOOK_VERSION } from "./applicationPdf/handbook/handbookText.js";

// Q-HB1: the packet's countersignature runs first in the same press and has its own tests
// (`packetCountersign.test.ts`). Here it succeeds and hands back the Representative it was given, so
// these stay about the handbook.
vi.mock("./packetCountersign.js", async (original) => ({
  ...(await original<typeof import("./packetCountersign.js")>()),
  countersignPacket: vi.fn(async (...args: unknown[]) => ({ representative: args[6], documentId: "doc-packet" })),
}));

/**
 * The office's half of the handbook (HANDBOOK-SIGNING-PLAN.md HB3): keep the driver's link alive, then
 * countersign and file it once the driver has signed their five places. The envelope the office sent
 * (`signing_opened_at`) is what opened it (D-AW16, C3s4b).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const REP = "11111111-2222-4333-8444-555555555555";
const OTHER_REP = "22222222-3333-4444-8555-666666666666";
const DRIVER_PLACES = ["h1", "h2", "h3", "h4", "h5"];

const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", submitted_at: "2026-09-25T10:00:00Z", signing_opened_at: "2026-09-25T09:00:00Z", handbook_filed_at: null,
  // Far enough out that no press in these tests needs to extend it, unless a test says otherwise.
  expires_at: "2099-01-01T00:00:00.000Z", ...over,
});

const filterOf = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;

const seed = (over: { invitation?: Record<string, unknown> | null; places?: string[]; carrierMarkError?: unknown; rep?: boolean; markVersion?: string; settings?: Record<string, unknown> } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: over.invitation === null ? [] : [invitation(over.invitation)],
      // No row is the product's defaults (Q-AW41) — the state of every org until it saves.
      recruiting_settings: over.settings ? [over.settings] : [],
      handbook_marks: (q: RecordedQuery) => {
        if (q.write) return over.carrierMarkError ? { writeError: over.carrierMarkError } : [];
        return (over.places ?? DRIVER_PLACES).map((placement_id) => ({
          placement_id, signed_name: "Jovana Petrović", signed_at: "2026-09-25T11:05:00Z", representative_id: placement_id === "h4c" ? REP : null,
          handbook_version: over.markVersion ?? HANDBOOK_VERSION,
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

describe("keeping the driver's link alive (APPLICATION-FLOW-V2-PLAN.md A-2)", () => {
  const NOW = new Date("2026-09-26T17:00:00.000Z");
  const FOURTEEN_DAYS_ON = "2026-10-10T17:00:00.000Z";

  it("extends an unfiled handbook's link, and writes nothing but the new end", async () => {
    // d61557dc's shape on 2026-09-26: filed, link lapsing 09-28 18:00 UTC.
    const rec = seed({ invitation: { expires_at: "2026-09-28T18:00:00.000Z" } });
    const result = await extendHandbookLink(rec.client, ORG, DRIVER, NOW);
    expect(result).toEqual({ invitationId: "inv-1", expiresAt: FOURTEEN_DAYS_ON, extended: true });
    const writes = rec.writtenRows("application_invitations");
    expect(writes).toEqual([{ expires_at: FOURTEEN_DAYS_ON }]);
    expectOrgScoped(rec, ORG);
  });

  it("changes nothing on a link that already outlives the window", async () => {
    const rec = seed();
    const result = await extendHandbookLink(rec.client, ORG, DRIVER, NOW);
    expect(result).toEqual({ invitationId: "inv-1", expiresAt: "2099-01-01T00:00:00.000Z", extended: false });
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("extends by the carrier's own link lifetime when it has chosen one (Q-AW41)", async () => {
    const rec = seed({
      invitation: { expires_at: "2026-09-20T00:00:00.000Z" },
      settings: { invite_ttl_days: 3, reminders_enabled: true, reminder_after_hours: 48, updated_at: "2026-09-28T00:00:00Z" },
    });
    const result = await extendHandbookLink(rec.client, ORG, DRIVER, NOW);
    expect(!isHandbookError(result) && result.expiresAt).toBe("2026-09-29T17:00:00.000Z");
    expect(rec.writtenRows("application_invitations")).toEqual([{ expires_at: "2026-09-29T17:00:00.000Z" }]);
    expectOrgScoped(rec, ORG);
  });

  it("revives a link that has already lapsed", async () => {
    const rec = seed({ invitation: { expires_at: "2026-09-20T00:00:00.000Z" } });
    const result = await extendHandbookLink(rec.client, ORG, DRIVER, NOW);
    expect(!isHandbookError(result) && result.expiresAt).toBe(FOURTEEN_DAYS_ON);
  });

  it("never shortens a link, and never extends a filed or unfiled-application one", async () => {
    expect(handbookLinkExpiry("2026-10-30T00:00:00.000Z", NOW, 14)).toBeNull();
    expect(handbookLinkExpiry(FOURTEEN_DAYS_ON, NOW, 14)).toBeNull();
    expect(handbookLinkExpiry("2026-10-10T16:59:59.999Z", NOW, 14)).toBe(FOURTEEN_DAYS_ON);

    const filed = seed({ invitation: { handbook_filed_at: "2026-09-25T12:00:00Z", expires_at: "2026-09-27T00:00:00.000Z" } });
    expect(isHandbookError(await extendHandbookLink(filed.client, ORG, DRIVER, NOW))).toBe(true);
    expect(filed.writtenRows("application_invitations")).toHaveLength(0);
    const unfiled = seed({ invitation: { submitted_at: null, expires_at: "2026-09-27T00:00:00.000Z" } });
    expect(isHandbookError(await extendHandbookLink(unfiled.client, ORG, DRIVER, NOW))).toBe(true);
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

  it("refuses an application never sent for signing, and a handbook already filed", async () => {
    const closed = await countersignHandbook(seed({ invitation: { signing_opened_at: null } }).client, ORG, "u", null, DRIVER, REP);
    expect(isHandbookError(closed) && closed.code).toBe("not_opened");
    const filed = await countersignHandbook(seed({ invitation: { handbook_filed_at: "2026-09-25T12:00:00Z" } }).client, ORG, "u", null, DRIVER, REP);
    expect(isHandbookError(filed) && filed.code).toBe("already_filed");
  });

  it("refuses to file a handbook whose places were signed under another text, and files nothing (A-6)", async () => {
    const rec = seed({ markVersion: "handbook-older" });
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result) && result.code).toBe("handbook_changed");
    expect(rec.writtenRows("handbook_marks")).toHaveLength(0);
    expect(rec.writtenRows("documents")).toHaveLength(0);
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

    // A-10: the claim is the FIRST write to the invitation, before any document; the stamp is the last.
    const [claim, stamp] = rec.writtenRows("application_invitations");
    expect(typeof claim!.handbook_filing_claimed_at).toBe("string");
    expect(rec.writes()[0]!.table).toBe("application_invitations");
    expect(typeof stamp!.handbook_filed_at).toBe("string");
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

describe("the packet's carrier lines, in the same press (Q-HB1, D-HB7)", () => {
  it("countersigns the packet FIRST, and h4c is signed by the Representative the packet's row recorded", async () => {
    // A retry whose packet row already names REP: the press asked for OTHER_REP, and the handbook must
    // follow the packet, or one press would put two people's names on the carrier's side.
    vi.mocked(countersignPacket).mockResolvedValueOnce({
      representative: { id: REP, fullName: "Miroslav Jokovic", title: "Safety manager", signature: null },
      documentId: "doc-packet",
    });
    const rec = seed();
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, OTHER_REP);
    expect(!isHandbookError(result) && result.packetDocumentId).toBe("doc-packet");
    expect(rec.writtenRows("handbook_marks")[0]).toMatchObject({ placement_id: "h4c", representative_id: REP });
    expect(vi.mocked(countersignPacket).mock.calls.at(-1)!.slice(1, 6)).toEqual([ORG, "u-1", "admin", DRIVER, "inv-1"]);
  });

  it("files nothing of the handbook when the packet's countersign fails, and hands the claim back", async () => {
    vi.mocked(countersignPacket).mockResolvedValueOnce({ code: "storage_failed", message: "no" });
    const rec = seed();
    const result = await countersignHandbook(rec.client, ORG, "u-1", "admin", DRIVER, REP);
    expect(isHandbookError(result) && result.code).toBe("storage_failed");
    expect(rec.writtenRows("handbook_marks")).toHaveLength(0);
    expect(rec.writtenRows("documents")).toHaveLength(0);
    const [, release] = rec.writtenRows("application_invitations");
    expect(release).toMatchObject({ handbook_filing_claimed_at: null });
  });

  it("answers the packet's lapsed link in the handbook's own words", async () => {
    vi.mocked(countersignPacket).mockResolvedValueOnce({ code: "link_expired", message: "short" });
    const result = await countersignHandbook(seed().client, ORG, "u-1", "admin", DRIVER, REP);
    expect(result).toEqual(HANDBOOK_LINK_EXPIRED);
  });
});

describe("the office's view of it", () => {
  it("reports it opened by the envelope, the places signed, and driver-complete (D-AW16)", async () => {
    const result = await driverHandbookStatus(seed().client, ORG, DRIVER);
    expect(isHandbookError(result)).toBe(false);
    expect(!isHandbookError(result) && result.driverComplete).toBe(true);
    expect(!isHandbookError(result) && result.openedAt).toBe("2026-09-25T09:00:00Z");
  });

  it("does not call it open while the application the envelope carries is unfiled (HB022)", async () => {
    const result = await driverHandbookStatus(seed({ invitation: { submitted_at: null }, places: [] }).client, ORG, DRIVER);
    expect(!isHandbookError(result) && result.canOpen).toBe(false);
    expect(!isHandbookError(result) && result.openedAt).toBeNull();
  });
});
