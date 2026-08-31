import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { recordSyncedCredentials, SYNC_NOTE } from "./syncedCredentials.js";

/**
 * R1 — the TMS-sourced licence and medical card become evidence (D-ARC3; DRIVER-ROSTER-PLAN Q2,
 * answered option (a) on 2026-08-30).
 *
 * The assertion that carries this file is `writes nothing when the current row already says the same
 * thing`. `insert_certification` supersedes UNCONDITIONALLY, and this runs on a nightly sweep over an
 * append-only table pinned in `RETENTION_FORBIDDEN` — so a version that files on every sweep would
 * pass any test that only checked "does it write the right values", while quietly adding a row per
 * driver per credential per night to the one table nothing is allowed to prune.
 */

const ORG = "org-1";
const DRIVER = "driver-1";

/** The RPC returns `[{ id, superseded_id }]`; only the shape matters to the caller. */
const rpcOk = { insert_certification: [{ id: "cert-new", superseded_id: null }] };

const certRow = (over: Partial<{ kind: string; identifier: string | null; issuing_authority: string | null; expires_at: string | null }>) => ({
  kind: "cdl", identifier: null, issuing_authority: null, expires_at: null, ...over,
});

const make = (current: unknown[], rpc: unknown = rpcOk) =>
  createSupabaseRecorder({ tables: { certifications: current }, rpc: rpc as Record<string, unknown> });

const args = (rec: ReturnType<typeof make>) =>
  rec.rpcs().map((r) => r.args as Record<string, unknown>);

/** The nth recorded RPC's arguments, asserted to exist — a missing call is a failure, not `undefined`. */
const arg = (rec: ReturnType<typeof make>, n: number): Record<string, unknown> => {
  const all = args(rec);
  expect(all.length).toBeGreaterThan(n);
  return all[n]!;
};

describe("recordSyncedCredentials — the write-only-on-change invariant", () => {
  it("files both credentials when the driver has no certifications yet", async () => {
    const rec = make([]);
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      cdlNumber: "D123", cdlState: "IL", cdlExpiresAt: "2028-04-01", medicalExpiresAt: "2027-02-15",
    });
    expect(out.written.sort()).toEqual(["cdl", "medical_card"]);
    expect(out.unchanged).toEqual([]);
    expect(out.failed).toEqual([]);

    const cdl = arg(rec, 0);
    const med = arg(rec, 1);
    expect(cdl.p_kind).toBe("cdl");
    expect(cdl.p_expires_at).toBe("2028-04-01");
    expect(cdl.p_identifier).toBe("D123");
    expect(cdl.p_issuing_authority).toBe("IL");
    expect(med.p_kind).toBe("medical_card");
    expect(med.p_expires_at).toBe("2027-02-15");
    // A sweep has no user behind it, and 0127's created_by is nullable precisely for that.
    expect(cdl.p_created_by).toBeNull();
    // Q6's marker. Until the DQ file can tell a dated requirement from a documented one, this note is
    // the only thing distinguishing a row nobody has a scan for.
    expect(cdl.p_notes).toBe(SYNC_NOTE);
  });

  /**
   * THE ONE THAT MATTERS. Same dates, second sweep: nothing is written.
   *
   * If this ever goes red, the sync is appending to an unprunable evidence table on every run —
   * roughly 120,000 rows a year on this carrier's 164-driver roster — and burying the supersede
   * chain an auditor reads.
   */
  it("writes nothing when the current rows already say the same thing", async () => {
    const rec = make([
      certRow({ kind: "cdl", identifier: "D123", issuing_authority: "IL", expires_at: "2028-04-01" }),
      certRow({ kind: "medical_card", expires_at: "2027-02-15" }),
    ]);
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      cdlNumber: "D123", cdlState: "IL", cdlExpiresAt: "2028-04-01", medicalExpiresAt: "2027-02-15",
    });
    expect(out.written).toEqual([]);
    expect(out.unchanged.sort()).toEqual(["cdl", "medical_card"]);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("files only the credential that moved", async () => {
    const rec = make([
      certRow({ kind: "cdl", identifier: "D123", issuing_authority: "IL", expires_at: "2028-04-01" }),
      certRow({ kind: "medical_card", expires_at: "2027-02-15" }),
    ]);
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      cdlNumber: "D123", cdlState: "IL", cdlExpiresAt: "2028-04-01", medicalExpiresAt: "2028-02-15",
    });
    expect(out.written).toEqual(["medical_card"]);
    expect(out.unchanged).toEqual(["cdl"]);
    expect(args(rec)).toHaveLength(1);
  });

  it("treats a corrected licence number or state as a change, not just the date", async () => {
    const rec = make([certRow({ kind: "cdl", identifier: "OLD", issuing_authority: "IL", expires_at: "2028-04-01" })]);
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      cdlNumber: "D123", cdlState: "IL", cdlExpiresAt: "2028-04-01",
    });
    expect(out.written).toEqual(["cdl"]);
    expect(arg(rec, 0).p_identifier).toBe("D123");
  });

  /**
   * McLeod is the carrier's system of record for these two fields and refreshes them on every sweep
   * (`rosterFields.ts:49-55`), so a date moving BACKWARDS is filed too. It will correctly un-qualify
   * the driver: if the safety department believes the card lapsed, the gate must fail closed rather
   * than keep dispatching on our more optimistic copy.
   */
  it("files an EARLIER expiry, because fail-closed is the right direction for a lapsed card", async () => {
    const rec = make([certRow({ kind: "medical_card", expires_at: "2027-02-15" })]);
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      medicalExpiresAt: "2026-09-01",
    });
    expect(out.written).toEqual(["medical_card"]);
    expect(arg(rec, 0).p_expires_at).toBe("2026-09-01");
  });
});

describe("recordSyncedCredentials — what it refuses to do", () => {
  it("never writes a null over a good value: an absent date files nothing", async () => {
    const rec = make([certRow({ kind: "medical_card", expires_at: "2027-02-15" })]);
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      cdlNumber: "D123", cdlState: "IL", medicalExpiresAt: null,
    });
    expect(out.written).toEqual([]);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("does not even read when the sweep supplied no dates at all", async () => {
    const rec = make([]);
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {});
    expect(out).toEqual({ written: [], unchanged: [], failed: [] });
    expect(rec.queries).toHaveLength(0);
  });

  it("reports a failed filing instead of throwing, so one bad credential cannot strand the sweep", async () => {
    const rec = make([], { insert_certification: { data: null, error: { message: "boom" } } });
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      medicalExpiresAt: "2027-02-15",
    });
    expect(out.written).toEqual([]);
    expect(out.failed).toEqual([{ kind: "medical_card", error: "boom" }]);
  });

  it("reports a failed READ instead of throwing", async () => {
    const rec = createSupabaseRecorder({
      tables: { certifications: { data: null, error: { message: "read blew up" } } },
      rpc: rpcOk,
    });
    const out = await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      medicalExpiresAt: "2027-02-15",
    });
    expect(out.failed).toHaveLength(1);
    // Nothing was filed on an unreadable current state — writing blind would supersede a row we
    // could not see, which is the one mistake an append-only table cannot forgive.
    expect(rec.rpcs()).toHaveLength(0);
  });
});

describe("recordSyncedCredentials — tenancy", () => {
  it("org-scopes its read (the service role bypasses RLS)", async () => {
    const rec = make([]);
    await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      medicalExpiresAt: "2027-02-15",
    });
    expectOrgScoped(rec, ORG);
  });

  it("passes the org through to the RPC rather than letting it default", async () => {
    const rec = make([]);
    await recordSyncedCredentials(rec.client as unknown as SupabaseClient, ORG, DRIVER, {
      medicalExpiresAt: "2027-02-15",
    });
    expect(arg(rec, 0).p_org_id).toBe(ORG);
    expect(arg(rec, 0).p_subject_id).toBe(DRIVER);
    expect(arg(rec, 0).p_subject_type).toBe("driver");
  });
});
