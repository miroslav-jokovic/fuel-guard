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
    expect(r).toEqual({ rehired: ["YALAM"], rehireReview: [], endedInTms: [] });
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
      expect(r, why).toEqual({ rehired: [], rehireReview: ["YALAM"], endedInTms: [] });
      expect(rec.writes(), why).toEqual([]);
    }
  });

  it("never reads a McLeod record that is not active as a rehire", async () => {
    const rec = seed([alam]);
    const r = await rehireFormerDrivers(rec.client, ORG, [{ ...yalam, status: "terminated" as const }], true);
    expect(r).toEqual({ rehired: [], rehireReview: [], endedInTms: [] });
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
    expect(await rehireFormerDrivers(live.client, ORG, [yalam], true)).toEqual({ rehired: [], rehireReview: [], endedInTms: [] });
    expect(live.writes()).toEqual([]);
  });

  it("leaves an inactive McLeod-owned row for a human when the payload does not say McLeod cleared the date", async () => {
    // `termination_date` absent is an agent that does not send it — not McLeod saying "no termination".
    const rec = seed([{ ...alam, archived_at: null }]);
    const r = await rehireFormerDrivers(rec.client, ORG, [{ ...yalam, hire_date: "2024-04-29" }], true);
    expect(r).toEqual({ rehired: [], rehireReview: ["YALAM"], endedInTms: [] });
  });
});

describe("McLeod taking back its own termination (D-RL6)", () => {
  // The production case of 2026-11-06: terminated in McLeod 10-28, copied here by the 10-30 retire run,
  // active again in McLeod by 11-04 with no termination date and the original 2024 hire date.
  const ninDiaz = driver({ id: "209f1049-257a-4892-be10-4d2de390a141", full_name: "AMABLE RAFAEL NIN DIAZ", cdl_number: "N1234567", status: "terminated", termination_date: "2026-10-28", identity_source: "mcleod", mcleod_driver_id: "AMABLER" });
  const amabler = { external_id: "AMABLER", company_id: "TMS", cdl_number: "N1234567", first_name: "AMABLE RAFAEL", last_name: "NIN DIAZ", hire_date: "2024-04-29", termination_date: null };
  const withAudit = (rows: Record<string, unknown>[], audit: Record<string, unknown>[]) =>
    createSupabaseRecorder({ tables: { drivers: rows, audit_logs: (q: RecordedQuery) => (q.write ? [] : audit) } });

  it("restores the row when McLeod lists them active with no termination date and nobody here ended it", async () => {
    const rec = withAudit([ninDiaz], [{ action: "driver.archived", actor_id: null, meta: {} }]);
    const r = await rehireFormerDrivers(rec.client, ORG, [amabler], true);
    expect(r).toEqual({ rehired: ["AMABLER"], rehireReview: [], endedInTms: [] });
    expect(rec.writtenRows("drivers")[0]).toEqual({ status: "active", archived_at: null, termination_date: null });
    const audit = rec.writtenRows("audit_logs").find((a) => a.action === "driver.rehired_from_tms")!;
    expect(audit.meta).toMatchObject({ proof: "tms_termination_reversed", previousTerminationDate: "2026-10-28", tmsHireDate: "2024-04-29" });
    expectOrgScoped(rec, ORG);
  });

  it("still leaves it for a human when somebody here terminated or archived the driver", async () => {
    const office: Array<[string, Record<string, unknown>]> = [
      ["terminated through the roster PATCH", { action: "driver.updated", actor_id: "u-1", meta: { fields: ["status"] } }],
      ["termination date typed here", { action: "driver.updated", actor_id: "u-1", meta: { fields: ["termination_date"] } }],
      ["archived by a member", { action: "driver.archived", actor_id: "u-1", meta: {} }],
    ];
    for (const [why, row] of office) {
      const rec = withAudit([ninDiaz], [row]);
      const r = await rehireFormerDrivers(rec.client, ORG, [amabler], true);
      expect(r, why).toEqual({ rehired: [], rehireReview: ["AMABLER"], endedInTms: [] });
      expect(rec.writes(), why).toEqual([]);
    }
  });

  it("is not fooled by an office edit of something else", async () => {
    const rec = withAudit([ninDiaz], [{ action: "driver.updated", actor_id: "u-1", meta: { fields: ["phone"] } }]);
    expect((await rehireFormerDrivers(rec.client, ORG, [amabler], true)).rehired).toEqual(["AMABLER"]);
  });

  it("brings nobody back when the audit read fails", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: [ninDiaz], audit_logs: { error: { message: "boom" } } } });
    expect(await rehireFormerDrivers(rec.client, ORG, [amabler], true)).toEqual({ rehired: [], rehireReview: ["AMABLER"], endedInTms: [] });
    expect(rec.writes()).toEqual([]);
  });

  it("brings nobody back while McLeod still carries a termination date, or onto an office-owned row", async () => {
    const dated = withAudit([ninDiaz], []);
    expect((await rehireFormerDrivers(dated.client, ORG, [{ ...amabler, termination_date: "2026-10-28" }], true)).rehired).toEqual([]);
    const manual = withAudit([{ ...ninDiaz, identity_source: "manual" }], []);
    expect((await rehireFormerDrivers(manual.client, ORG, [amabler], true)).rehired).toEqual([]);
  });
});

describe("a rehire never reaches an application", () => {
  it("never reaches an applicant — Tatjana's archived application carried another driver's licence", async () => {
    const rec = seed([driver({ id: "d-app", status: "applicant", archived_at: "2026-10-07T00:00:00Z", cdl_number: "T61521083", identity_source: "manual" })]);
    expect(await rehireFormerDrivers(rec.client, ORG, [ackiss], true)).toEqual({ rehired: [], rehireReview: [], endedInTms: [] });
  });
});

describe("a row the 09-14 cleanup archived without a termination date (D-RL9)", () => {
  // Production on 2026-11-09: WCHRISTO's only row is the July Samsara one the reconcile run archived on
  // 09-14 with no termination date; McLeod rehired him 11-03 and he drives daily.
  const weaver = driver({ id: "19ad7e75-1416-476d-9358-c0da44f80362", full_name: "CHRISTOPHER WEAVER", cdl_number: "W7654321", status: "inactive", identity_source: "samsara", mcleod_driver_id: "WCHRISTO", archived_at: "2026-09-14T19:10:53.359Z", termination_date: null });
  const wchristo = { external_id: "WCHRISTO", company_id: "TMS", cdl_number: "W7654321", first_name: "CHRISTOPHER", last_name: "WEAVER", hire_date: "2026-11-03", termination_date: null };
  const withAudit = (rows: Record<string, unknown>[], audit: Record<string, unknown>[]) =>
    createSupabaseRecorder({ tables: { drivers: rows, audit_logs: (q: RecordedQuery) => (q.write ? [] : audit) } });

  it("restores the row when McLeod's hire date is after the day it was archived, and audits the archive", async () => {
    const rec = withAudit([weaver], []);
    const r = await rehireFormerDrivers(rec.client, ORG, [wchristo], true);
    expect(r).toEqual({ rehired: ["WCHRISTO"], rehireReview: [], endedInTms: [] });
    expect(rec.writtenRows("drivers")[0]).toEqual({ status: "active", archived_at: null, termination_date: null });
    const audit = rec.writtenRows("audit_logs").find((a) => a.action === "driver.rehired_from_tms")!;
    expect(audit.meta).toMatchObject({ proof: "hire_after_archive", previousTerminationDate: null, previousArchivedAt: "2026-09-14T19:10:53.359Z", wasArchived: true });
    expectOrgScoped(rec, ORG);
  });

  it("leaves every weaker archive for a human", async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>[]]> = [
      ["hired the day it was archived", {}, { hire_date: "2026-09-14" }, []],
      ["hired before it was archived", {}, { hire_date: "2026-01-01" }, []],
      ["no hire date", {}, { hire_date: null }, []],
      ["the agent did not say McLeod has no termination date", {}, { termination_date: undefined }, []],
      ["a member archived the row", {}, {}, [{ action: "driver.archived", actor_id: "u-1", meta: {} }]],
      ["somebody here set the status", {}, {}, [{ action: "driver.updated", actor_id: "u-1", meta: { fields: ["status"] } }]],
      ["the office owns the row", { identity_source: "manual" }, {}, []],
      ["inactive but never archived — no day to compare", { archived_at: null }, {}, []],
    ];
    for (const [why, row, input, audit] of cases) {
      const rec = withAudit([{ ...weaver, ...row }], audit);
      const r = await rehireFormerDrivers(rec.client, ORG, [{ ...wchristo, ...input }], true);
      expect(r, why).toEqual({ rehired: [], rehireReview: ["WCHRISTO"], endedInTms: [] });
      expect(rec.writes(), why).toEqual([]);
    }
  });

  it("brings nobody back when the audit read fails", async () => {
    const rec = createSupabaseRecorder({ tables: { drivers: [weaver], audit_logs: { error: { message: "boom" } } } });
    expect((await rehireFormerDrivers(rec.client, ORG, [wchristo], true)).rehired).toEqual([]);
    expect(rec.writes()).toEqual([]);
  });
});

describe("McLeod lists a driver active with a last day (D-RL10)", () => {
  // Production on 2026-11-09: KSATTERW is_active Y, terminated 11-07, hired 2025-01-29; the retire run had
  // already terminated our row with that date. No hours or fuel after 11-06 — he left.
  const satterwhite = driver({ id: "bb80b059-ab0e-4ee1-bf84-1d74e9e73792", full_name: "KENNETH SATTERWHITE", cdl_number: "S1234567", status: "terminated", identity_source: "mcleod", mcleod_driver_id: "KSATTERW", termination_date: "2026-11-07" });
  const ksatterw = { external_id: "KSATTERW", company_id: "TMS", cdl_number: "S1234567", first_name: "KENNETH", last_name: "SATTERWHITE", hire_date: "2025-01-29", termination_date: "2026-11-07" };

  it("is held as ended in McLeod, never as a rehire, and nothing is written", async () => {
    const rec = seed([satterwhite]);
    expect(await rehireFormerDrivers(rec.client, ORG, [ksatterw], true)).toEqual({ rehired: [], rehireReview: [], endedInTms: ["KSATTERW"] });
    expect(rec.writes()).toEqual([]);
  });

  it("holds a last day still ahead the same way, and a row with no termination date too", async () => {
    const ahead = seed([{ ...satterwhite, termination_date: null, archived_at: "2026-09-14T19:10:00Z" }]);
    expect((await rehireFormerDrivers(ahead.client, ORG, [{ ...ksatterw, hire_date: "2026-10-01", termination_date: "2026-12-01" }], true)).endedInTms).toEqual(["KSATTERW"]);
    expect(ahead.writes()).toEqual([]);
  });

  it("does not treat an old termination McLeod never cleared, before a later hire, as an ending", async () => {
    const rec = seed([{ ...satterwhite, termination_date: "2026-09-14" }]);
    const r = await rehireFormerDrivers(rec.client, ORG, [{ ...ksatterw, hire_date: "2026-11-03", termination_date: "2026-09-01" }], true);
    expect(r).toEqual({ rehired: ["KSATTERW"], rehireReview: [], endedInTms: [] });
  });

  it("is never created a second time in create mode, and its row keeps its status", async () => {
    // The terminated (unarchived) row is still in the matcher's pool, so the sweep refreshes its name and
    // licence as for any linked driver; what must not happen is a new row or a status change.
    const rec = seed([satterwhite]);
    const r = await ingestDrivers(rec.client, ORG, [ksatterw], "create");
    expect(r.endedInTms).toEqual(["KSATTERW"]);
    const writes = rec.forTable("drivers").filter((q) => q.write);
    expect(writes.filter((q) => q.write!.method !== "update")).toEqual([]);
    expect(rec.writtenRows("drivers").filter((w) => "status" in w || "archived_at" in w || "termination_date" in w)).toEqual([]);
  });

  it("is never created beside an archived former row either (the matcher cannot see it)", async () => {
    const rec = seed([{ ...satterwhite, archived_at: "2026-11-07T19:35:00Z" }]);
    const r = await ingestDrivers(rec.client, ORG, [ksatterw], "create");
    expect(r.endedInTms).toEqual(["KSATTERW"]);
    expect(rec.writes().filter((q) => q.table === "drivers")).toEqual([]);
  });
});
