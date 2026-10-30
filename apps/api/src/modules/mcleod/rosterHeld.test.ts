import { describe, it, expect } from "vitest";
import type { RosterHeldDriver } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { clearedByRetire, heldFromIngest, mergeHeld } from "./rosterHeld.js";
import { ROSTER_HELD_PROVIDER, updateRosterHeld } from "./tmsIngest.js";

/**
 * The "needs a decision" list (ROSTER-LIFECYCLE-PLAN RL3). Fixtures are the production shapes of
 * 2026-10-30: Curtis Hairston held as an applicant, Streetie Virgin held on a fuel-card row by name.
 */
const T1 = "2026-10-30T20:16:03.000Z";
const T2 = "2026-10-30T20:31:03.000Z";
const hairston = { external_id: "CHAIRSTO", first_name: "CURTIS", last_name: "HAIRSTON", hire_date: "2026-10-28" };
const virgin = { external_id: "SVIRGIN", first_name: "STREETIE", last_name: "VIRGIN", hire_date: "2026-10-29" };
const buren = { external_id: "JBUREN", first_name: "JOHN", last_name: "BUREN", hire_date: "2026-10-30" };
const none = { unmatched: [], ambiguous: [], applicants: [], retry: [] };
const held = (over: Partial<RosterHeldDriver>): RosterHeldDriver => ({
  externalId: "X", name: "X", hireDate: null, reason: "not_created", since: T1, ...over,
});

describe("heldFromIngest — one reason per driver", () => {
  it("names each bucket the ingest reported, with McLeod's name and hire date", () => {
    const out = heldFromIngest([hairston, virgin, buren], {
      ...none, applicants: ["CHAIRSTO"], unmatched: ["JBUREN"], retry: ["CHAIRSTO", "JBUREN", "SVIRGIN"],
    }, T1);
    expect(out).toEqual([
      { externalId: "CHAIRSTO", name: "CURTIS HAIRSTON", hireDate: "2026-10-28", reason: "applicant", since: T1 },
      { externalId: "JBUREN", name: "JOHN BUREN", hireDate: "2026-10-30", reason: "not_created", since: T1 },
      { externalId: "SVIRGIN", name: "STREETIE VIRGIN", hireDate: "2026-10-29", reason: "fuel_card", since: T1 },
    ]);
  });

  it("reads the fuel-card stand-off as what retry holds beyond the named buckets — and nothing else", () => {
    expect(heldFromIngest([virgin], { ...none, retry: ["SVIRGIN"] }, T1).map((d) => d.reason)).toEqual(["fuel_card"]);
    expect(heldFromIngest([hairston], { ...none, applicants: ["CHAIRSTO"], retry: ["CHAIRSTO"] }, T1).map((d) => d.reason)).toEqual(["applicant"]);
  });

  it("explains an unproven rehire as a rehire, though the ingest also counted it unmatched", () => {
    const out = heldFromIngest([buren], { ...none, unmatched: ["JBUREN"], retry: ["JBUREN"], rehireReview: ["JBUREN"] }, T1);
    expect(out.map((d) => d.reason)).toEqual(["rehire_review"]);
  });

  it("holds nobody when everything settled", () => {
    expect(heldFromIngest([hairston, buren], none, T1)).toEqual([]);
  });
});

describe("mergeHeld — a POST speaks only for the drivers it carried", () => {
  const hairstonHeld = held({ externalId: "CHAIRSTO", reason: "applicant" });
  const virginHeld = held({ externalId: "SVIRGIN", reason: "fuel_card" });

  it("drops a driver who was carried and settled — Hairston once his hire is finished", () => {
    expect(mergeHeld([hairstonHeld, virginHeld], ["CHAIRSTO"], [])).toEqual([virginHeld]);
  });

  it("keeps a driver this POST did not carry — a quiet sweep, or the other batch of a large one", () => {
    expect(mergeHeld([hairstonHeld], ["JBUREN"], [])).toEqual([hairstonHeld]);
  });

  it("keeps how long a driver has waited while the reason is unchanged, and restarts it when it changes", () => {
    const again = mergeHeld([hairstonHeld], ["CHAIRSTO"], [held({ externalId: "CHAIRSTO", reason: "applicant", since: T2 })]);
    expect(again[0]!.since).toBe(T1);
    const changed = mergeHeld([hairstonHeld], ["CHAIRSTO"], [held({ externalId: "CHAIRSTO", reason: "ambiguous", since: T2 })]);
    expect(changed[0]).toMatchObject({ reason: "ambiguous", since: T2 });
  });
});

describe("clearedByRetire", () => {
  it("drops a held driver McLeod has since made inactive — they are no longer anybody's decision", () => {
    const list = [held({ externalId: "CHAIRSTO" }), held({ externalId: "SVIRGIN" })];
    expect(clearedByRetire(list, ["CHAIRSTO", "AMABLER"])).toEqual([held({ externalId: "SVIRGIN" })]);
  });
});

describe("updateRosterHeld — the row it lives on", () => {
  it("creates the org's row on first use with a full insert, scoped to the org", async () => {
    const rec = createSupabaseRecorder({ tables: { org_integrations: () => [] } });
    await updateRosterHeld(rec.client, "org-1", () => [held({ externalId: "CHAIRSTO" })]);
    const row = rec.writtenRows("org_integrations")[0]!;
    expect(row).toMatchObject({ org_id: "org-1", provider: ROSTER_HELD_PROVIDER, enabled: true });
    expect((row.config as { drivers: RosterHeldDriver[] }).drivers.map((d) => d.externalId)).toEqual(["CHAIRSTO"]);
    expectOrgScoped(rec, "org-1");
  });

  it("writes nothing when the list did not change, so its time means when it last changed", async () => {
    const list = [held({ externalId: "CHAIRSTO" })];
    const rec = createSupabaseRecorder({ tables: { org_integrations: () => [{ config: { drivers: list } }] } });
    await updateRosterHeld(rec.client, "org-1", (prev) => prev);
    expect(rec.writes()).toEqual([]);
  });
});
