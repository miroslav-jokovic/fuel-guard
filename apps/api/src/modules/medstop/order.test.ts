import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MedstopOrderInput } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { MedstopClient } from "./client.js";
import { placeOrder, prepareOrder } from "./order.js";

/**
 * Ordering a Med-Stop test (MEDSTOP-PLAN.md §7A.4, UX3). Every order is billed and real — there is no
 * Med-Stop test host — so what is proved here is what is REFUSED, and that the one thing sent carries
 * the office's contact with Med-Stop's own texts and e-mails off (owner answer 5).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TODAY = "2026-10-14";
const office = { email: "der@silvicom.test", phone: "3125550100" };
const base: MedstopOrderInput = {
  medstopId: "EE-ANN", service: "drug", reason: "POST-ACCIDENT", locationId: "LOC-1",
  requestDate: "2026-10-15", requestTime: "09:30", notifyBy: "PHONE CALL",
};

const drivers = [
  { id: "d-ann", full_name: "Ann Pooled", first_name: "Ann", last_name: "Pooled", date_of_birth: null, cdl_number: "A1", cdl_state: "IL", status: "active", archived_at: null },
  { id: "d-nam", full_name: "Nam Only", first_name: "Nam", last_name: "Only", date_of_birth: null, cdl_number: null, cdl_state: null, status: "active", archived_at: null },
];
const employees = [
  { medstop_id: "EE-ANN", roster: "active", driver_id: "d-ann", match_rule: "licence" },
  { medstop_id: "EE-NAM", roster: "active", driver_id: "d-nam", match_rule: "name" },
];
const db = (selections: unknown[] = []) =>
  createSupabaseRecorder({ tables: { drivers, medstop_employees: employees, medstop_selections: selections } });

type Call = { method: string; path: string; body: unknown };
function medstop(opts: { open?: unknown[]; post?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname + u.search;
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(init.body as string) : null });
    if (u.pathname.startsWith("/Request/for/")) {
      const rows = opts.open ?? [];
      return rows.length ? new Response(JSON.stringify({ rows: [rows] }), { status: 200 }) : new Response("{}", { status: 404 });
    }
    if (u.pathname.startsWith("/Request/new/"))
      // Measured 2026-10-13: the prefilled form already carries the DRIVER's phone in `tosms`.
      return new Response(JSON.stringify({ data: { id: "REQ-FORM-1", eeid: "ee-ann", tosms: "7735550199", toemail: "" } }), { status: 200 });
    if (init?.method === "POST" && u.pathname === "/Request/new") return opts.post ? opts.post() : new Response(JSON.stringify({ data: { id: "REQ-FORM-1" } }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { client: new MedstopClient({ apiKey: "k", baseUrl: "https://api.med-stop.com", fetchImpl, maxRetries: 0, sleep: async () => {} }), calls };
}

describe("prepareOrder — what is refused", () => {
  it("refuses a person matched by name only (R3): a name never orders a billed test on somebody", async () => {
    const { client } = medstop();
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, { ...base, medstopId: "EE-NAM" }, TODAY);
    expect(r).toMatchObject({ refusal: { status: 404, code: "medstop_person_unknown" } });
  });

  it("refuses a second order while Med-Stop holds an unfinished one for the same test — asked live", async () => {
    const { client, calls } = medstop({ open: [{ status: "OPEN", category: "DRUG TEST" }] });
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, base, TODAY);
    expect(r).toMatchObject({ refusal: { status: 409, code: "medstop_order_open" } });
    expect(calls.map((c) => c.path)).toEqual(["/Request/for/EE-ANN?page=1&pagesize=100"]);
  });

  it("does not count an open ALCOHOL order against a drug test, nor a finished drug one", async () => {
    const { client } = medstop({ open: [{ status: "OPEN", category: "ALCOHOL TEST" }, { status: "COMPLETED", category: "DRUG TEST" }] });
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, base, TODAY);
    expect(r).toHaveProperty("payload");
  });

  it("refuses when Med-Stop cannot be asked about open orders, rather than ordering blind", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const client = new MedstopClient({ apiKey: "k", baseUrl: "https://api.med-stop.com", fetchImpl, maxRetries: 0, sleep: async () => {} });
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, base, TODAY);
    expect(r).toMatchObject({ refusal: { status: 502, code: "medstop_unreachable" } });
  });

  it("refuses a random order whose selection is someone else's, already ordered, or for the other test", async () => {
    const random = { ...base, reason: "RANDOM" as const, selectionId: "SEL-1" };
    const sel = (over: object) => [{ employee_medstop_id: "EE-ANN", service: "TD", status: "OPEN", request_medstop_id: null, ...over }];
    const { client } = medstop();
    const run = (s: unknown[]) => prepareOrder(db(s).client as unknown as SupabaseClient, client, office, ORG, random, TODAY);
    expect(await run(sel({ employee_medstop_id: "EE-OTHER" }))).toMatchObject({ refusal: { code: "medstop_selection_not_open" } });
    expect(await run(sel({ status: "COMPLETED" }))).toMatchObject({ refusal: { code: "medstop_selection_not_open" } });
    expect(await run(sel({ request_medstop_id: "REQ-9" }))).toMatchObject({ refusal: { code: "medstop_selection_ordered" } });
    expect(await run(sel({ service: "TA" }))).toMatchObject({ refusal: { code: "medstop_selection_service" } });
    expect(await run(sel({}))).toHaveProperty("payload");
  });

  it("refuses a collection day in the past", async () => {
    const { client } = medstop();
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, { ...base, requestDate: "2026-10-13" }, TODAY);
    expect(r).toMatchObject({ refusal: { code: "medstop_order_day" } });
  });

  it("org-scopes every read (the service role bypasses RLS)", async () => {
    const rec = db([{ employee_medstop_id: "EE-ANN", service: "TD", status: "OPEN", request_medstop_id: null }]);
    await prepareOrder(rec.client as unknown as SupabaseClient, medstop().client, office, ORG, { ...base, reason: "RANDOM", selectionId: "SEL-1" }, TODAY);
    expectOrgScoped(rec, ORG);
  });
});

describe("placeOrder — the one write", () => {
  it("sends the office's contact over the driver's prefilled phone, texts and e-mails off, once", async () => {
    const { client, calls } = medstop();
    const r = await placeOrder(db().client as unknown as SupabaseClient, client, office, ORG, base, TODAY);
    expect(r).toMatchObject({ requestId: "REQ-FORM-1" });
    const posts = calls.filter((c) => c.method !== "GET");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/Request/new");
    expect(posts[0]!.body).toMatchObject({
      id: "REQ-FORM-1", eeid: "EE-ANN", category: "TD", reason: "POST-ACCIDENT", payment: "EMPLOYER",
      sendsms: "N", sendemail: "N", tosms: "3125550100", toemail: "der@silvicom.test",
    });
  });

  it("seeds a random order's form from its selection, so Med-Stop links the two", async () => {
    const { client, calls } = medstop();
    await placeOrder(db([{ employee_medstop_id: "EE-ANN", service: "TD", status: "OPEN", request_medstop_id: null }]).client as unknown as SupabaseClient,
      client, office, ORG, { ...base, reason: "RANDOM", selectionId: "SEL-1" }, TODAY);
    expect(calls.some((c) => c.path === "/Request/new/SEL-1")).toBe(true);
  });

  it("never retries a POST: a 500 is one attempt, reported as Med-Stop's refusal", async () => {
    const { client, calls } = medstop({ post: () => new Response(JSON.stringify({ msg: { msg: "Site closed at that time" } }), { status: 500 }) });
    const r = await placeOrder(db().client as unknown as SupabaseClient, client, office, ORG, base, TODAY);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(r).toMatchObject({ refusal: { code: "medstop_order_refused", message: expect.stringContaining("Site closed") } });
  });

  it("reports an unanswered POST as unknown — it may have been placed — never as a failure to retry", async () => {
    const { client } = medstop({ post: () => { throw new TypeError("socket hang up"); } });
    const r = await placeOrder(db().client as unknown as SupabaseClient, client, office, ORG, base, TODAY);
    expect(r).toMatchObject({ refusal: { code: "medstop_order_unknown", message: expect.stringContaining("Check Med-Stop before ordering again") } });
  });

  it("places nothing when a refusal comes first", async () => {
    const { client, calls } = medstop({ open: [{ status: "TESTING", service: "TD" }] });
    await placeOrder(db().client as unknown as SupabaseClient, client, office, ORG, base, TODAY);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("MedstopClient.write — the allow-list", () => {
  it("refuses every Med-Stop write but POST /Request/new before anything is sent", async () => {
    const { client, calls } = medstop();
    for (const path of ["/Request/REQ-1/notify", "/Test/T-1/result", "/Employee/E-1/remove", "/Request"])
      await expect(client.write("POST", path, {})).rejects.toThrow(/not a Med-Stop write/);
    expect(calls).toHaveLength(0);
  });
});
