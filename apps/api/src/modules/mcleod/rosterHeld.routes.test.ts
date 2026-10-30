import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { RosterHeldDriver } from "@silvicom/shared";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * The routes that feed the "needs a decision" list (ROSTER-LIFECYCLE-PLAN RL3), through the real
 * router. The list's logic is pinned in `rosterHeld.test.ts`; what is pinned here is that the routes
 * call it at all, with what the sweep actually carried, and never from a report, which decides nothing.
 */
const updates: Array<(prev: RosterHeldDriver[]) => RosterHeldDriver[]> = [];
const ingestResult = { unmatched: [] as string[], ambiguous: [] as string[], applicants: ["CHAIRSTO"], retry: ["CHAIRSTO"] };
const retireResult: { refused?: string } = {};

vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("./rosterMastery.js", () => ({ isTmsRosterMaster: async () => true }));
vi.mock("./rosterIngest.js", () => ({
  ingestDrivers: async () => ingestResult,
  ingestVehicles: async () => ({}),
  ingestTrailers: async () => ({}),
}));
vi.mock("./rosterRetire.js", () => ({
  retireFromTms: async () => retireResult,
  reconcileAbsentFromTms: async () => ({}),
}));
vi.mock("./tmsIngest.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./tmsIngest.js")>();
  return {
    ...real,
    orgForIngestToken: async () => ({ orgId: "org-1", provider: "mcleod" }),
    touchLastSynced: async () => {},
    updateRosterHeld: async (_a: unknown, _o: string, next: (prev: RosterHeldDriver[]) => RosterHeldDriver[]) => {
      updates.push(next);
    },
  };
});

const { tmsIngestRouter } = await import("./routes/tmsIngest.js");

let server: Server;
const post = async (path: string, body: unknown) => {
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer fgtms_test" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
};
const hairston = { external_id: "CHAIRSTO", company_id: "TMS", first_name: "CURTIS", last_name: "HAIRSTON", hire_date: "2026-10-28" };
const held = (id: string): RosterHeldDriver => ({ externalId: id, name: id, hireDate: null, reason: "applicant", since: "2026-10-30T00:00:00.000Z" });

beforeEach(async () => {
  updates.length = 0;
  delete retireResult.refused;
  const app = express();
  app.use("/api/tms", tmsIngestRouter());
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
});
afterEach(async () => {
  await closeTestServer(server);
});

describe("the driver sweep records what it held", () => {
  it("in create mode: Hairston, held as an applicant, joins the list", async () => {
    await post("/api/tms/roster/drivers?mode=create", { drivers: [hairston] });
    expect(updates).toHaveLength(1);
    expect(updates[0]!([])).toMatchObject([{ externalId: "CHAIRSTO", name: "CURTIS HAIRSTON", reason: "applicant" }]);
  });

  it("speaks only for the drivers it carried — another held driver stays on the list", async () => {
    await post("/api/tms/roster/drivers?mode=create", { drivers: [hairston] });
    expect(updates[0]!([held("SVIRGIN")]).map((d) => d.externalId)).toEqual(["SVIRGIN", "CHAIRSTO"]);
  });

  it("not from a report, which decides nothing", async () => {
    await post("/api/tms/roster/drivers?mode=report", { drivers: [hairston] });
    expect(updates).toHaveLength(0);
  });
});

describe("the retire sweep clears departures", () => {
  it("drops a held driver McLeod made inactive", async () => {
    await post("/api/tms/roster/drivers/retire", { retire: [{ external_id: "CHAIRSTO", status: "terminated" }] });
    expect(updates).toHaveLength(1);
    expect(updates[0]!([held("CHAIRSTO"), held("SVIRGIN")]).map((d) => d.externalId)).toEqual(["SVIRGIN"]);
  });

  it("changes nothing when the API refused the retirement as a bad fetch", async () => {
    retireResult.refused = "would retire 300 of 185";
    await post("/api/tms/roster/drivers/retire", { retire: [{ external_id: "CHAIRSTO", status: "terminated" }] });
    expect(updates).toHaveLength(0);
  });

  it("only for drivers — a retired truck is nobody on this list", async () => {
    await post("/api/tms/roster/vehicles/retire", { retire: [{ external_id: "556", status: "inactive" }] });
    expect(updates).toHaveLength(0);
  });
});
