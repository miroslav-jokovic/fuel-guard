import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { decideAttribution } from "./decide.js";

/**
 * A person's decision over the engine's reading (IC5, plan §6 "confirm"). The recorder does not
 * filter, so each fixture applies the filters its query asked for: a read that forgets the source
 * would take the person's row for the reading, one that forgets `org_id` another carrier's driver.
 */

const ORG = "org-1";
const INSP = "11111111-1111-4111-8111-111111111111";
const val = (q: RecordedQuery, method: string, col: string) => q.ops.find((o) => o.method === method && o.args[0] === col)?.args[1];
/** The order the query asked for on `created_at`: 1 ascending, -1 descending, 0 (insertion order) when it asked none. */
const orderOf = (q: RecordedQuery) => {
  const o = q.ops.find((op) => op.method === "order" && op.args[0] === "created_at");
  return o ? ((o.args[1] as { ascending?: boolean } | undefined)?.ascending === false ? -1 : 1) : 0;
};

const reading = (extra: Record<string, unknown> = {}) => ({
  id: "eng-1", org_id: ORG, inspection_id: INSP, source: "engine", engine_version: "ic5.1", created_at: "2026-10-14T10:00:00Z",
  outcome: "one_driver", confidence: "low", basis: "before_only", zone: "America/Chicago", zone_method: "gps",
  started_at: "2026-09-22T18:04:00Z", ended_at: "2026-09-22T18:27:00Z", location_check: "confirmed",
  vehicle_id: "veh-1", samsara_vehicle_id: "2120", samsara_driver_id: "s-ann", samsara_driver_name: "Ann Samsara",
  candidates: [{ samsaraDriverId: "s-ann", name: "Ann Samsara", passenger: false, segments: [] }],
  decided_by: null, driver_id: null, note: null, ...extra,
});
const DRIVERS = [
  { id: "d-ann", org_id: ORG, samsara_driver_id: "s-ann", status: "active", full_name: "Ann Roster" },
  { id: "d-bob", org_id: ORG, samsara_driver_id: null, status: "terminated", full_name: "Bob Former" },
  { id: "d-new", org_id: ORG, samsara_driver_id: null, status: "applicant", full_name: "Cal Applicant" },
  { id: "d-x", org_id: "org-2", samsara_driver_id: null, status: "active", full_name: "Other Carrier" },
];

function recorder(rows: Record<string, unknown>[], opts: { inspection?: boolean; insertError?: unknown } = {}) {
  return createSupabaseRecorder({
    tables: {
      roadside_inspections: (q) =>
        opts.inspection === false ? [] : [{ id: INSP, org_id: ORG }].filter((r) => r.org_id === val(q, "eq", "org_id") && r.id === val(q, "eq", "id")),
      inspection_attributions: (q) => {
        if (q.write) return opts.insertError ? { data: null, error: opts.insertError } : [{ id: "new-1" }];
        return rows
          .filter((r) => r.org_id === val(q, "eq", "org_id") && r.inspection_id === val(q, "eq", "inspection_id") && r.source === val(q, "eq", "source"))
          .sort((a, b) => orderOf(q) * String(a.created_at).localeCompare(String(b.created_at)));
      },
      drivers: (q) => DRIVERS.filter((d) => d.org_id === val(q, "eq", "org_id") && d.id === val(q, "eq", "id") && d.status !== val(q, "neq", "status")),
      audit_logs: [],
    },
  });
}
const inserted = (rec: ReturnType<typeof recorder>) => rec.writtenRows("inspection_attributions");
const audits = (rec: ReturnType<typeof recorder>) => rec.writtenRows("audit_logs");

describe("confirming the reading", () => {
  it("writes a person's row that restates the reading, names no driver of its own, and audits it with the previous row", async () => {
    const rec = recorder([reading()]);
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "confirm", basedOn: "eng-1", note: "Seen on the log" })).toEqual({ ok: true, id: "new-1" });
    const { id: _id, created_at: _c, source: _s, decided_by: _d, note: _n, ...copied } = reading();
    expect(inserted(rec)).toEqual([{ ...copied, source: "person", decided_by: "u-1", driver_id: null, note: "Seen on the log" }]);
    expect(audits(rec)).toEqual([
      expect.objectContaining({
        org_id: ORG, actor_id: "u-1", action: "roadside.attribution_confirmed", entity: "roadside_inspection", entity_id: INSP,
        meta: { attributionId: "new-1", engineVersion: "ic5.1", driverId: null, samsaraDriverId: "s-ann",
          previous: { attributionId: "eng-1", source: "engine", driverId: null, samsaraDriverId: "s-ann" } },
      }),
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("stores no note when none is given", async () => {
    const rec = recorder([reading()]);
    await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "confirm", basedOn: "eng-1", note: "" });
    expect(inserted(rec)[0]!.note).toBeNull();
  });

  it("refuses to confirm a reading that names no single driver", async () => {
    const rec = recorder([reading({ outcome: "several_drivers", samsara_driver_id: null, samsara_driver_name: null, basis: null, confidence: null })]);
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "confirm", basedOn: "eng-1" })).toMatchObject({ ok: false, status: 409, code: "nothing_to_confirm" });
    expect(inserted(rec)).toEqual([]);
  });
});

describe("correcting the driver", () => {
  it("names a former driver of ours, with the note, over the latest person's row", async () => {
    const earlier = reading({ id: "p-1", source: "person", created_at: "2026-10-14T11:00:00Z", decided_by: "u-9", driver_id: "d-ann" });
    const rec = recorder([reading(), earlier]);
    const out = await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "correct", basedOn: "p-1", driverId: "d-bob", note: "Bob signed the report" });
    expect(out).toEqual({ ok: true, id: "new-1" });
    // The reading copied is the ENGINE's, not the earlier person's row.
    expect(inserted(rec)[0]).toMatchObject({ source: "person", driver_id: "d-bob", note: "Bob signed the report", samsara_driver_id: "s-ann", engine_version: "ic5.1" });
    expect(audits(rec)[0]).toMatchObject({
      action: "roadside.attribution_corrected",
      meta: { driverId: "d-bob", previous: { attributionId: "p-1", source: "person", driverId: "d-ann" } },
    });
    expectOrgScoped(rec, ORG);
  });

  it.each([
    ["an applicant", "d-new"],
    ["another carrier's driver", "d-x"],
    ["nobody", "d-none"],
  ])("refuses %s", async (_what, driverId) => {
    const rec = recorder([reading()]);
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "correct", basedOn: "eng-1", driverId, note: "n" })).toMatchObject({ ok: false, status: 422, code: "unknown_driver" });
    expect(inserted(rec)).toEqual([]);
  });

  it("refuses the driver the reading already names, as a correction", async () => {
    const rec = recorder([reading()]);
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "correct", basedOn: "eng-1", driverId: "d-ann", note: "n" })).toMatchObject({ ok: false, status: 422, code: "same_as_reading" });
  });
});

describe("what a decision is refused over", () => {
  it("an inspection that is not ours or not current", async () => {
    const rec = recorder([reading()], { inspection: false });
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "confirm", basedOn: "eng-1" })).toMatchObject({ ok: false, status: 404 });
    expect(rec.forTable("roadside_inspections")[0]!.ops.some((o) => o.method === "is" && o.args[0] === "vanished_at")).toBe(true);
  });

  it("an inspection the engine has not read yet", async () => {
    const rec = recorder([]);
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "confirm", basedOn: "eng-1" })).toMatchObject({ ok: false, status: 409, code: "not_read" });
  });

  it.each([
    ["someone decided since the page loaded", [reading(), reading({ id: "p-2", source: "person", created_at: "2026-10-14T12:00:00Z", decided_by: "u-2" })], "eng-1"],
    ["the engine re-read at a new version", [reading({ id: "eng-2", engine_version: "ic5.2", created_at: "2026-10-14T13:00:00Z" }), reading({ id: "p-1", source: "person", created_at: "2026-10-14T11:00:00Z", decided_by: "u-2" })], "p-1"],
  ])("a page that is behind: %s", async (_what, rows, basedOn) => {
    const rec = recorder(rows);
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "confirm", basedOn })).toMatchObject({ ok: false, status: 409, code: "changed" });
    expect(inserted(rec)).toEqual([]);
  });

  it("a failed insert is the route's error, and nothing is audited", async () => {
    const rec = recorder([reading()], { insertError: { message: "IA010" } });
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "confirm", basedOn: "eng-1" })).toEqual({ error: { message: "IA010" } });
    expect(audits(rec)).toEqual([]);
  });

  it("an audit outage does not undo a recorded decision", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = createSupabaseRecorder({
      tables: {
        roadside_inspections: [{ id: INSP, org_id: ORG }],
        inspection_attributions: (q) => (q.write ? [{ id: "new-1" }] : val(q, "eq", "source") === "engine" ? [reading()] : []),
        audit_logs: { data: [], writeError: { message: "down" } },
      },
    });
    expect(await decideAttribution(rec.client as never, ORG, INSP, "u-1", { action: "confirm", basedOn: "eng-1" })).toEqual({ ok: true, id: "new-1" });
    expect(err.mock.calls.some((c) => String(c[0]).includes("[audit] write failed"))).toBe(true);
    err.mockRestore();
  });
});
