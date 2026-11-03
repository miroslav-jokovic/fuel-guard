import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MedstopOrderInput } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../testing/postgrestFixture.js";
import { MedstopClient } from "./client.js";
import { placeOrder, prepareOrder, siteObservedFor } from "./order.js";

/**
 * A recollection after a negative-dilute result (MEDSTOP-PLAN.md §7A.21, MSO3, owner's ruling D-MSO4). Pinned:
 * it is ordered only on THIS person's own negative-dilute DRUG test, read from the mirror; it is unobserved
 * unless the office chose observation, and then it takes UX5d's path — the donor's gender read live and never
 * sent, refused before billing when Med-Stop holds none; and a random test's recollection needs no selection.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0f0f0f0f-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-11-03";
const office = { email: "der@x.test", phone: "3125550100" };
const base: MedstopOrderInput = {
  medstopId: "EE-ANN", service: "drug", reason: "POST-ACCIDENT", locationId: "LOC-1",
  requestDate: "2026-11-04", requestTime: "16:00", notifyBy: "PHONE CALL", recollectionOf: "T-DIL",
};

const test = (over: object) => ({ org_id: ORG, medstop_id: "T-DIL", employee_medstop_id: "EE-ANN", service: "TD", status: "CLOSED", result: "NEGATIVE - DILUTE", ...over });
const db = (tests = [test({})]) =>
  createSupabaseRecorder({
    tables: {
      drivers: [
        { id: "d-ann", full_name: "Ann Pooled", first_name: "Ann", last_name: "Pooled", date_of_birth: null, cdl_number: "A1", cdl_state: "IL", status: "active", archived_at: null },
      ],
      medstop_employees: [{ medstop_id: "EE-ANN", roster: "active", driver_id: "d-ann", match_rule: "licence" }],
      medstop_tests: postgrestFixture(tests),
      medstop_selections: [],
    },
  });

type Call = { method: string; path: string; body: unknown };
function medstop(gender: string | null = "MALE") {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init?.method ?? "GET", path: u.pathname + u.search, body: init?.body ? JSON.parse(init.body as string) : null });
    if (u.pathname.startsWith("/Request/for/")) return new Response("{}", { status: 404 });
    if (u.pathname === "/Employee/EE-ANN") return new Response(JSON.stringify({ data: { id: "EE-ANN", gender } }), { status: 200 });
    if (u.pathname.startsWith("/Request/new/")) return new Response(JSON.stringify({ data: { id: "FORM-1", eeid: "EE-ANN" } }), { status: 200 });
    if (init?.method === "POST") return new Response(JSON.stringify({ data: { id: "FORM-1" } }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new MedstopClient({ apiKey: "k", baseUrl: "https://api.med-stop.com", fetchImpl, maxRetries: 0, sleep: async () => {} }), calls };
}
const as = (r: ReturnType<typeof db>) => r.client as unknown as SupabaseClient;

describe("which test a recollection may repeat", () => {
  it("orders it on the person's own negative-dilute drug result, unobserved by default, org-scoped", async () => {
    const rec = db();
    const r = await prepareOrder(as(rec), medstop().client, office, ORG, base, TODAY);
    expect(r).toMatchObject({ payload: { observed: "N", reason: "POST-ACCIDENT" } });
    expectOrgScoped(rec, ORG);
  });

  it("refuses a test that is not negative-dilute, not a drug test, not this person's, another org's, or none at all", async () => {
    for (const tests of [
      [test({ result: "NEGATIVE" })],
      [test({ result: "NEGATIVE - DILUTE", status: "AT LAB" })], // not yet verified by the MRO
      [test({ service: "TA" })],
      [test({ employee_medstop_id: "EE-BOB" })],
      [test({ org_id: OTHER })],
      [],
    ]) {
      const { client, calls } = medstop();
      expect(await prepareOrder(as(db(tests)), client, office, ORG, base, TODAY)).toMatchObject({ refusal: { status: 409, code: "medstop_recollection_not_dilute" } });
      expect(calls).toEqual([]);
    }
  });
});

describe("the office's observed choice (D-MSO4)", () => {
  it("sends it observed, citing §40.197(b)(1), after reading the donor's gender live — and never sends the gender", async () => {
    const { client, calls } = medstop("FEMALE");
    const r = await placeOrder(as(db()), client, office, ORG, { ...base, observed: true }, TODAY);
    expect(r).toMatchObject({ payload: { observed: "Y", observedreason: expect.stringContaining("40.197(b)(1)") } });
    expect(calls.filter((c) => c.path === "/Employee/EE-ANN")).toHaveLength(1);
    expect(JSON.stringify(calls.find((c) => c.method === "POST")!.body)).not.toMatch(/gender|FEMALE/i);
  });

  it("refuses an observed recollection before billing when Med-Stop holds no gender", async () => {
    const { client, calls } = medstop(null);
    expect(await placeOrder(as(db()), client, office, ORG, { ...base, observed: true }, TODAY)).toMatchObject({ refusal: { code: "medstop_gender_missing" } });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("searches for an observer of the donor's gender only when observation was chosen", async () => {
    const { client } = medstop("MALE");
    const q = { reason: "POST-ACCIDENT" as const, service: "drug" as const, medstopId: "EE-ANN" };
    expect(await siteObservedFor(as(db()), client, ORG, q)).toEqual({ observed: "N" });
    expect(await siteObservedFor(as(db()), client, ORG, { ...q, observed: true })).toEqual({ observed: "M", eeid: "EE-ANN" });
  });

  it("orders a random test's recollection without a selection, from the person", async () => {
    const { client, calls } = medstop();
    const r = await placeOrder(as(db()), client, office, ORG, { ...base, reason: "RANDOM" }, TODAY);
    expect(r).toMatchObject({ payload: { reason: "RANDOM" } });
    expect(calls.some((c) => c.path === "/Request/new/EE-ANN")).toBe(true);
  });
});
