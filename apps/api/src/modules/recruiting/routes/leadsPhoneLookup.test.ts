import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import type { PhoneLookupClient } from "../leads/phoneLookup.js";

/**
 * V7a / LQ8b at the typed-in lead's door (`POST /recruitment/leads`): the number is looked up after the store, a
 * duplicate is not asked again, and a lookup that fails never fails the request. Kept apart from `leads.test.ts`,
 * which is at its size budget. The reader's own behaviour is `leads/phoneLookup.test.ts`.
 */

const holder = vi.hoisted(() => ({ client: null as unknown, lookup: null as PhoneLookupClient | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
vi.mock("../leads/phoneLookup.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../leads/phoneLookup.js")>();
  return { ...real, phoneLookupFor: () => (holder.lookup ? { client: holder.lookup, dailyMax: 500 } : null) };
});

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD = "50000000-0000-4000-8000-000000000001";
const recruiter = { userId: "u-recruiter", email: "r@x.test", orgId: ORG, role: "recruiter" } as AuthContext;

let server: Server;
let baseUrl: string;
const asked: string[] = [];
const telnyx: PhoneLookupClient = {
  async lookup(n) {
    asked.push(n);
    return { kind: "answered", projection: { line_type: "landline", carrier: "AT&T", valid: true }, raw: {} };
  },
};

function seed(opts: { stored?: "new" | "duplicate"; lookupsBroken?: boolean } = {}) {
  const rec = createSupabaseRecorder({
    tables: {
      phone_lookups: (q: RecordedQuery) => (opts.lookupsBroken ? { data: null, error: { message: "down" } } : q.write ? { data: null } : { data: [], count: 0 }),
      lead_match_verdicts: [], audit_logs: [], memberships: [],
    },
    rpc: (fn) => (fn === "ingest_lead" ? { lead_id: LEAD, stored: opts.stored ?? "new", matches: { leads: [], drivers: [] } } : null),
  });
  holder.client = rec.client;
  return rec;
}
const add = () => fetch(`${baseUrl}/api/recruitment/leads`, {
  method: "POST",
  headers: { "content-type": "application/json", Authorization: "Bearer recruiter" },
  body: JSON.stringify({ channel: "phone_call", full_name: "Ray Driver", phone: "(708) 236-5732", email: null, opening_id: null, note: null }),
});

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  app.locals.verifyToken = async (t: string) => {
    if (t !== "recruiter") throw new Error("bad token");
    return recruiter;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => { await closeTestServer(server); });

describe("a typed-in lead's number is looked up (V7a)", () => {
  it("after the store, and stored for this carrier", async () => {
    holder.lookup = telnyx;
    asked.length = 0;
    const rec = seed();
    expect((await add()).status).toBe(201);
    expect(asked).toEqual(["+17082365732"]);
    const write = rec.queries.find((q) => q.table === "phone_lookups" && q.write);
    expect(write?.write?.payload).toMatchObject({ org_id: ORG, phone_e164: "+17082365732", line_type: "landline" });
    expectOrgScoped(rec, ORG, { exempt: ["user_profiles"] });
  });

  it("not for a lead the store already had", async () => {
    holder.lookup = telnyx;
    asked.length = 0;
    seed({ stored: "duplicate" });
    expect((await add()).status).toBe(201);
    expect(asked).toEqual([]);
  });

  it("a lookup that cannot reach its table still adds the lead", async () => {
    holder.lookup = telnyx;
    seed({ lookupsBroken: true });
    expect((await add()).status).toBe(201);
  });

  it("with the lookup off, nothing is asked", async () => {
    holder.lookup = null;
    asked.length = 0;
    const rec = seed();
    expect((await add()).status).toBe(201);
    expect([asked, rec.queries.filter((q) => q.table === "phone_lookups")]).toEqual([[], []]);
  });
});
