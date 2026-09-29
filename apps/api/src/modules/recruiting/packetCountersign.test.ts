import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { carrierPlacementIds, driverPlacementIds } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { renderPacketOverlay } from "./applicationPdf/packet/packetOverlay.js";
import { pageText, readPdfPages } from "./applicationPdf/packet/packetTemplate.js";
import { countersignPacket, isPacketCountersignError, type PrintableRepresentative } from "./packetCountersign.js";

/**
 * The carrier's countersignature on the filed packet (Q-HB1; HANDBOOK-SIGNING-PLAN.md §6, D-HB7..D-HB11).
 *
 * The driver's filing is stubbed at `file.ts` (it has its own tests); everything after it is real: the
 * row, the stamp on real packet bytes, the filed copy, the row's one write and the second record.
 */
const filedAs = vi.hoisted(() => ({ packet: true }));
vi.mock("./applicationPdf/file.js", async (original) => ({
  ...(await original<typeof import("./applicationPdf/file.js")>()),
  ensureDriverFiledApplication: vi.fn(async () => ({ documentId: "doc-filed", storagePath: "org/driver/d/doc-filed.pdf", rendered: false })),
  filedAsPacket: vi.fn(async () => filedAs.packet),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const DRIVER = "22222222-2222-4222-8222-222222222222";
const REP = "33333333-3333-4333-8333-333333333333";
const OTHER_REP = "44444444-4444-4444-8444-444444444444";
const ROW = "55555555-5555-4555-8555-555555555555";

let filedBytes: Buffer;
let filedSha: string;
beforeAll(async () => {
  filedBytes = await renderPacketOverlay({
    marks: driverPlacementIds(null).map((placementId) => ({ placementId, signedName: "Jovana Petrović-Szczepańska" })),
  });
  filedSha = createHash("sha256").update(filedBytes).digest("hex");
});

const CHOSEN: PrintableRepresentative = { id: OTHER_REP, fullName: "Somebody Else", title: "Owner", signature: null };

interface Seed {
  /** The row an earlier press left, returned on the unique index's 23505. */
  existing?: Record<string, unknown>;
  insertError?: { code: string; message: string };
  records?: unknown[];
  download?: "ok" | "fail";
  application?: boolean;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: ROW, representative_id: OTHER_REP, recorded_by: "u-1", placements: carrierPlacementIds(),
  source_sha256: filedSha, document_id: null, signed_at: "2026-09-30T03:00:00Z", ...over,
});

const seed = (s: Seed = {}) => createSupabaseRecorder({
  tables: {
    driver_applications: s.application === false ? [] : [{ id: "app-1" }],
    application_packet_countersignatures: (q: RecordedQuery) => {
      if (q.write?.method === "insert") {
        if (s.insertError) return { writeError: s.insertError };
        return [row({ representative_id: (q.write.payload as { representative_id: string }).representative_id,
          placements: (q.write.payload as { placements: string[] }).placements })];
      }
      if (q.write) return [];
      return s.existing ? [s.existing] : [];
    },
    carrier_representatives: (q: RecordedQuery) =>
      q.filters().some((f) => f.col === "id" && f.val === REP)
        ? [{ id: REP, full_name: "Miroslav Jokovic", title: "Safety manager", signature_path: `${ORG}/representatives/r.png` }]
        : [],
    organizations: [{ operating_hours: { tz: "America/Chicago" } }],
    documents: [],
    qualification_records: (q: RecordedQuery) => (q.write ? [] : (s.records ?? [])),
    memberships: [],
    user_profiles: [],
  },
  storage: {
    download: async () =>
      s.download === "fail"
        ? { data: null, error: { message: "gone" } }
        : { data: new Blob([new Uint8Array(filedBytes)]), error: null },
    upload: async () => ({ data: {}, error: null }),
  },
});

const run = (rec: ReturnType<typeof seed>) => countersignPacket(rec.client, ORG, "u-1", "admin", DRIVER, "inv-1", CHOSEN);

describe("countersigning the filed packet (Q-HB1)", () => {
  it("records the row, files the stamped copy under the row's id, writes it onto the row, and adds a record citing it", async () => {
    filedAs.packet = true;
    const rec = seed();
    const result = await run(rec);
    expect(isPacketCountersignError(result)).toBe(false);

    const [inserted, update] = rec.writtenRows("application_packet_countersignatures");
    expect(inserted).toMatchObject({
      org_id: ORG, invitation_id: "inv-1", application_id: "app-1", representative_id: OTHER_REP, recorded_by: "u-1",
      placements: ["p18c", "p19ac", "p19bc", "p22c"], source_sha256: filedSha,
    });
    expect(update).toEqual({ document_id: ROW });
    // The one write is conditional on the column still being null, so a racing press cannot re-point it.
    const write = rec.forTable("application_packet_countersignatures").find((q) => q.write?.method === "update")!;
    expect(write.ops).toContainEqual({ method: "is", args: ["document_id", null] });

    // The copy's id IS the row's, so a retry after a crash finds it rather than filing a second one.
    expect(rec.writtenRows("documents")[0]).toMatchObject({ id: ROW, kind: "employment_application", subject_id: DRIVER });
    expect(!isPacketCountersignError(result) && result.documentId).toBe(ROW);

    // D-HB11: a NEW record, referencing the countersignature (never the application id, which is how
    // the driver's own record is found), and the first record is not written to at all.
    const records = rec.writtenRows("qualification_records");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "employment_application", driver_id: DRIVER, document_id: ROW, reference: ROW, result: "Countersigned",
      performed_by: "Somebody Else, Owner", occurred_on: "2026-09-29",
    });
    expect(records[0]!.detail).toMatchObject({
      source: "packet_countersign", countersignature_id: ROW, driver_filing_document_id: "doc-filed", application_id: "app-1",
    });
    expectOrgScoped(rec, ORG, { exempt: ["organizations", "memberships", "user_profiles"] });
  });

  it("changes nothing on the filed bytes but the four carrier lines", async () => {
    filedAs.packet = true;
    const rec = seed();
    await run(rec);
    const upload = rec.storageCalls().find((c) => c.fn === "upload")!;
    const stamped = await readPdfPages(new Uint8Array(upload.args[1] as Buffer));
    const source = await readPdfPages(new Uint8Array(filedBytes));
    expect(stamped).toHaveLength(source.length);
    const carrierPages = new Set([18, 19, 22]);
    for (const [i, page] of stamped.entries()) {
      if (carrierPages.has(i + 1)) {
        expect(pageText(page)).toContain("applied by an office user in Silvicom 360 · 09/29/2026");
        expect(pageText(page).startsWith(pageText(source[i]!))).toBe(true);
      } else {
        expect(pageText(page), `page ${i + 1}`).toBe(pageText(source[i]!));
      }
    }
  });

  it("for the §391.21 summary: no lines, no copy, no second record — the filing itself is cited (D-HB10)", async () => {
    filedAs.packet = false;
    const rec = seed();
    const result = await run(rec);
    filedAs.packet = true;
    expect(!isPacketCountersignError(result) && result.documentId).toBe("doc-filed");
    expect(rec.writtenRows("application_packet_countersignatures")[0]).toMatchObject({ placements: [] });
    expect(rec.writtenRows("application_packet_countersignatures")[1]).toEqual({ document_id: "doc-filed" });
    expect(rec.storageCalls().some((c) => c.fn === "upload")).toBe(false);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("resumes an earlier press with the Representative ITS row recorded, not the one asked for now", async () => {
    const rec = seed({ existing: row({ representative_id: REP }), insertError: { code: "23505", message: "duplicate" } });
    const result = await run(rec);
    expect(!isPacketCountersignError(result) && result.representative.id).toBe(REP);
    expect(rec.writtenRows("qualification_records")[0]).toMatchObject({ performed_by: "Miroslav Jokovic, Safety manager" });
  });

  it("finishes a press that died after the copy was cited: no second copy, but the missing record is added", async () => {
    const rec = seed({ existing: row({ document_id: ROW }), insertError: { code: "23505", message: "duplicate" } });
    const result = await run(rec);
    expect(!isPacketCountersignError(result) && result.documentId).toBe(ROW);
    expect(rec.storageCalls().some((c) => c.fn === "upload")).toBe(false);
    expect(rec.writtenRows("application_packet_countersignatures")).toHaveLength(1); // the insert attempt only
    expect(rec.writtenRows("qualification_records")).toHaveLength(1);
  });

  it("adds no second record when the one citing the copy is already on file", async () => {
    const rec = seed({ existing: row({ document_id: ROW }), insertError: { code: "23505", message: "duplicate" }, records: [{ id: "r" }] });
    expect(isPacketCountersignError(await run(rec))).toBe(false);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("refuses to stamp bytes other than the ones its row signed, and files nothing", async () => {
    const rec = seed({ existing: row({ source_sha256: "0".repeat(64) }), insertError: { code: "23505", message: "duplicate" } });
    const result = await run(rec);
    expect(isPacketCountersignError(result) && result.code).toBe("packet_changed");
    expect(rec.storageCalls().some((c) => c.fn === "upload")).toBe(false);
    expect(rec.writtenRows("qualification_records")).toHaveLength(0);
  });

  it("answers link_expired on 0387's PC021, and the plain refusals for the rest", async () => {
    const lapsed = await run(seed({ insertError: { code: "PC021", message: "unusable" } }));
    expect(isPacketCountersignError(lapsed) && lapsed.code).toBe("link_expired");
    const other = await run(seed({ insertError: { code: "PC024", message: "filed" } }));
    expect(isPacketCountersignError(other) && other.code).toBe("insert_failed");
    const none = await run(seed({ application: false }));
    expect(isPacketCountersignError(none) && none.code).toBe("not_found");
    const unread = await run(seed({ download: "fail" }));
    expect(isPacketCountersignError(unread) && unread.code).toBe("storage_failed");
  });
});
