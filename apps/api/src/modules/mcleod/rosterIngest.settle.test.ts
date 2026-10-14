import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";
import { ingestDrivers } from "./rosterIngest.js";
import { rehireFormerDrivers } from "./rosterDriverSettle.js";

/**
 * Whether a McLeod driver settles onto one of our rows (D-MR16, D-MR7a) — the gaps the Seats card audit
 * found on 2026-10-14. Each fixture is a production shape from that day: an EFS-provisioned new hire,
 * and a driver the 09-14 reconcile run archived whom McLeod rehired on 09-30.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const driver = (over: Record<string, unknown> = {}) => ({
  id: "d-1", org_id: ORG, status: "active", identity_source: "efs", cdl_number: null, full_name: "AARON ACKISS",
  mcleod_driver_id: null, archived_at: null, termination_date: null, ...over,
});

/** A drivers fixture that honours the one filter that matters here: the matcher's `archived_at is null`. */
const seed = (rows: Record<string, unknown>[]) =>
  createSupabaseRecorder({
    tables: {
      drivers: (q: RecordedQuery) =>
        q.ops.some((o) => o.method === "is" && o.args[0] === "archived_at" && o.args[1] === null)
          ? rows.filter((r) => r.archived_at == null)
          : rows,
    },
  });

const ackiss = { external_id: "AACKISS", company_id: "TMS", cdl_number: "T61521083", first_name: "AARON", last_name: "ACKISS", hire_date: "2026-10-05" };

describe("an EFS-provisioned row (D-MR16)", () => {
  it("is claimed when McLeod meets it on the licence", async () => {
    const rec = seed([driver({ cdl_number: "T61521083" })]);
    const r = await ingestDrivers(rec.client, ORG, [ackiss], "identity");
    const w = rec.writtenRows("drivers").find((x) => "mcleod_driver_id" in x)!;
    expect(w).toMatchObject({ mcleod_driver_id: "AACKISS", identity_source: "mcleod", hire_date: "2026-10-05" });
    expect(r.skippedOwned).toBe(0);
    expect(r.retry).toEqual([]);
    expectOrgScoped(rec, ORG);
  });

  it("is still refused on a name alone — and asked for again, because its licence may arrive", async () => {
    const rec = seed([driver()]);
    const r = await ingestDrivers(rec.client, ORG, [ackiss], "identity");
    expect(rec.writtenRows("drivers")).toEqual([]);
    expect(r.skippedOwned).toBe(1);
    expect(r.retry).toEqual(["AACKISS"]);
  });

  it("is claimed when it already carries McLeod's id", async () => {
    const rec = seed([driver({ mcleod_driver_id: "AACKISS" })]);
    await ingestDrivers(rec.client, ORG, [ackiss], "identity");
    expect(rec.writtenRows("drivers")[0]).toMatchObject({ identity_source: "mcleod" });
  });

  it("leaves an office-owned row alone, and does not ask for it again", async () => {
    const rec = seed([driver({ identity_source: "manual", cdl_number: "T61521083" })]);
    const r = await ingestDrivers(rec.client, ORG, [ackiss], "identity");
    expect(rec.writtenRows("drivers")).toEqual([]);
    expect(r.retry).toEqual([]);
  });
});

describe("retry — what the agent must send again", () => {
  it("names every row this run could not settle", async () => {
    const rec = seed([driver({ id: "d-a", cdl_number: "DUP1" }), driver({ id: "d-b", cdl_number: "DUP1", full_name: "X" })]);
    const r = await ingestDrivers(rec.client, ORG, [
      { external_id: "NEWHIRE", cdl_number: "NOPE", first_name: "ASA", last_name: "MAYEUX" },
      { external_id: "TWIN", cdl_number: "DUP1", first_name: "Q", last_name: "Q" },
    ], "identity");
    expect(r.retry.sort()).toEqual(["NEWHIRE", "TWIN"]);
  });
});

describe("a rehire (D-MR7a)", () => {
  const alam = driver({ id: "5f0c2a1e-9d3b-4c6a-8e2f-1b7d4a9c3e10", full_name: "YOUNESS ALAM", cdl_number: "A233155598000", status: "terminated", termination_date: "2026-09-14", archived_at: "2026-09-14T19:10:42Z" });
  const yalam = { external_id: "YALAM", company_id: "TMS", cdl_number: "A233155598000", first_name: "YOUNESS", last_name: "ALAM", hire_date: "2026-09-30" };

  it("restores a former row when McLeod's hire date is after our termination date, and audits the old date", async () => {
    const rec = seed([alam]);
    const r = await rehireFormerDrivers(rec.client, ORG, [yalam], true);
    expect(r).toEqual({ rehired: ["YALAM"], rehireReview: [] });
    expect(rec.writtenRows("drivers")[0]).toEqual({ status: "active", archived_at: null, termination_date: null });
    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit).toMatchObject({ action: "driver.rehired_from_tms", entity_id: "5f0c2a1e-9d3b-4c6a-8e2f-1b7d4a9c3e10" });
    expect(audit.meta).toMatchObject({ previousTerminationDate: "2026-09-14", tmsHireDate: "2026-09-30", wasArchived: true });
    expectOrgScoped(rec, ORG);
  });

  it("runs before the matcher loads, so the restored row is linked by the same sweep", async () => {
    const rec = seed([alam]);
    const r = await ingestDrivers(rec.client, ORG, [yalam], "identity");
    expect(r.rehired).toEqual(["YALAM"]);
    const drivers = rec.forTable("drivers");
    const firstWrite = drivers.findIndex((q) => q.write);
    const candidateRead = drivers.findIndex((q) => q.ops.some((o) => o.method === "is" && o.args[0] === "archived_at"));
    expect(firstWrite).toBeGreaterThanOrEqual(0);
    expect(candidateRead).toBeGreaterThan(firstWrite);
  });

  it("writes nothing in report mode, and counts it", async () => {
    const rec = seed([alam]);
    const r = await ingestDrivers(rec.client, ORG, [yalam], "report");
    expect(r.rehired).toEqual(["YALAM"]);
    expect(rec.writes()).toEqual([]);
  });

  it("does not run in link mode — link writes a link and nothing else", async () => {
    const rec = seed([alam]);
    const r = await ingestDrivers(rec.client, ORG, [yalam], "link");
    expect(r.rehired).toBeUndefined();
  });

  it("leaves every weaker case for a human", async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["hire date on the termination date", {}, { hire_date: "2026-09-14" }],
      ["hire date before it", {}, { hire_date: "2026-01-01" }],
      ["no termination date to compare", { termination_date: null }, {}],
      ["no hire date", {}, { hire_date: null }],
      ["the office owns the row", { identity_source: "manual" }, {}],
    ];
    for (const [why, row, input] of cases) {
      const rec = seed([{ ...alam, ...row }]);
      const r = await rehireFormerDrivers(rec.client, ORG, [{ ...yalam, ...input }], true);
      expect(r, why).toEqual({ rehired: [], rehireReview: ["YALAM"] });
      expect(rec.writes(), why).toEqual([]);
    }
  });

  it("never reads a McLeod record that is not active as a rehire", async () => {
    const rec = seed([alam]);
    const r = await rehireFormerDrivers(rec.client, ORG, [{ ...yalam, status: "terminated" as const }], true);
    expect(r).toEqual({ rehired: [], rehireReview: [] });
    expect(rec.writes()).toEqual([]);
  });

  it("refuses two former rows answering the same McLeod driver", async () => {
    const rec = seed([alam, { ...alam, id: "d-alam-2", cdl_number: null, mcleod_driver_id: "YALAM" }]);
    const r = await rehireFormerDrivers(rec.client, ORG, [yalam], true);
    expect(r.rehireReview).toEqual(["YALAM"]);
    expect(rec.writes()).toEqual([]);
  });

  it("never brings back somebody on a name, and never when a live row already answers", async () => {
    const byName = seed([{ ...alam, cdl_number: null }]);
    expect((await rehireFormerDrivers(byName.client, ORG, [yalam], true)).rehired).toEqual([]);
    const live = seed([alam, driver({ id: "d-live", cdl_number: "A233155598000" })]);
    expect(await rehireFormerDrivers(live.client, ORG, [yalam], true)).toEqual({ rehired: [], rehireReview: [] });
    expect(live.writes()).toEqual([]);
  });

  it("never reaches an applicant — Tatjana's archived application carried another driver's licence", async () => {
    const rec = seed([driver({ id: "d-app", status: "applicant", archived_at: "2026-10-07T00:00:00Z", cdl_number: "T61521083", identity_source: "manual" })]);
    expect(await rehireFormerDrivers(rec.client, ORG, [ackiss], true)).toEqual({ rehired: [], rehireReview: [] });
  });
});
