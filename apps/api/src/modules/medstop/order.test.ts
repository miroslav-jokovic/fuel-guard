import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MedstopOrderInput } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { MedstopClient } from "./client.js";
import { findSites, placeOrder, prepareOrder, siteObservedFor } from "./order.js";

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
  { id: "d-app", full_name: "Al Applicant", first_name: "Al", last_name: "Applicant", date_of_birth: null, cdl_number: "B2", cdl_state: "IL", status: "applicant", archived_at: null },
  // Hired here; Med-Stop still lists him as an applicant.
  { id: "d-hir", full_name: "Hal Hired", first_name: "Hal", last_name: "Hired", date_of_birth: null, cdl_number: "C3", cdl_state: "IL", status: "active", archived_at: null },
];
const employees = [
  { medstop_id: "EE-ANN", roster: "active", driver_id: "d-ann", match_rule: "licence" },
  { medstop_id: "EE-NAM", roster: "active", driver_id: "d-nam", match_rule: "name" },
  { medstop_id: "EE-APP", roster: "applicant", driver_id: "d-app", match_rule: "licence" },
  { medstop_id: "EE-HIR", roster: "applicant", driver_id: "d-hir", match_rule: "licence" },
];
const db = (selections: unknown[] = []) =>
  createSupabaseRecorder({ tables: { drivers, medstop_employees: employees, medstop_selections: selections } });

type Call = { method: string; path: string; body: unknown };
function medstop(opts: { open?: unknown[]; post?: () => Response; gender?: string | null } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname + u.search;
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(init.body as string) : null });
    if (u.pathname.startsWith("/Request/for/")) {
      const rows = opts.open ?? [];
      return rows.length ? new Response(JSON.stringify({ rows: [rows] }), { status: 200 }) : new Response("{}", { status: 404 });
    }
    if (/^\/Employee\/EE-[A-Z]+$/.test(u.pathname))
      // Med-Stop's own record of the person (measured 2026-10-13: `gender` in capitals).
      return new Response(JSON.stringify({ data: { id: u.pathname.slice(10), gender: opts.gender === undefined ? "MALE" : opts.gender } }), { status: 200 });
    if (u.pathname === "/Request/location") return new Response(JSON.stringify({ rows: [[{ id: "LOC-7", name: "Observed site" }]] }), { status: 200 });
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

  it("orders pre-employment only on Med-Stop's applicant roster, for our applicant — and every other reason only on its active roster", async () => {
    const { client } = medstop();
    const run = (o: Partial<MedstopOrderInput>) => prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, { ...base, ...o }, TODAY);
    expect(await run({ medstopId: "EE-APP", reason: "PRE-EMPLOYMENT" })).toMatchObject({
      payload: { eeid: "EE-APP", reason: "PRE-EMPLOYMENT", sendsms: "N", sendemail: "N", tosms: office.phone },
      person: { driverId: "d-app", name: "Al Applicant" },
    });
    // A working driver is never ordered a pre-employment test, nor an applicant a post-accident one.
    expect(await run({ medstopId: "EE-ANN", reason: "PRE-EMPLOYMENT" })).toMatchObject({ refusal: { code: "medstop_person_unknown", message: expect.stringContaining("Add them in Med-Stop first") } });
    expect(await run({ medstopId: "EE-APP", reason: "POST-ACCIDENT" })).toMatchObject({ refusal: { code: "medstop_person_unknown" } });
    // Hired here, still an applicant in Med-Stop: the two disagree, so neither reason orders on him.
    expect(await run({ medstopId: "EE-HIR", reason: "PRE-EMPLOYMENT" })).toMatchObject({ refusal: { code: "medstop_person_unknown" } });
    expect(await run({ medstopId: "EE-HIR", reason: "POST-ACCIDENT" })).toMatchObject({ refusal: { code: "medstop_person_unknown" } });
  });

  it("refuses a pre-employment order while Med-Stop holds an unfinished one for the applicant — the hiring step's duplicate", async () => {
    const { client, calls } = medstop({ open: [{ status: "PROCESSING", category: "DRUG TEST", reason: "PRE-EMPLOYMENT" }] });
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, { ...base, medstopId: "EE-APP", reason: "PRE-EMPLOYMENT" }, TODAY);
    expect(r).toMatchObject({ refusal: { status: 409, code: "medstop_order_open" } });
    expect(calls.map((c) => c.path)).toEqual(["/Request/for/EE-APP?page=1&pagesize=100"]);
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

/**
 * UX5d — return-to-duty and follow-up drug tests are directly observed (§40.67(b)). The donor's gender
 * is Med-Stop's: read live at order time (Q-MSUX10), used to refuse and to pick the site search, and
 * never in what is sent or returned.
 */
describe("observed orders (UX5d)", () => {
  const rtd = { ...base, reason: "RETURN TO DUTY" as const };

  it("reads the donor's gender from Med-Stop live and sends the order observed — with no gender in it", async () => {
    const { client, calls } = medstop();
    const r = await placeOrder(db().client as unknown as SupabaseClient, client, office, ORG, rtd, TODAY);
    expect(r).toMatchObject({ requestId: "REQ-FORM-1", payload: { observed: "Y" } });
    expect(calls.filter((c) => c.path === "/Employee/EE-ANN")).toHaveLength(1);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ reason: "RETURN TO DUTY", observed: "Y", observedreason: expect.stringContaining("40.67(b)"), sendsms: "N", sendemail: "N" });
    expect(JSON.stringify(post.body)).not.toMatch(/gender|MALE/i);
    expect(JSON.stringify(r)).not.toMatch(/gender|MALE/i);
  });

  it("refuses, in the office's words and before anything is billed, a donor Med-Stop holds no gender for", async () => {
    for (const gender of [null, "", "U"]) {
      const { client, calls } = medstop({ gender });
      const r = await placeOrder(db().client as unknown as SupabaseClient, client, office, ORG, { ...rtd, reason: "FOLLOW-UP" }, TODAY);
      expect(r).toMatchObject({ refusal: { status: 409, code: "medstop_gender_missing", message: "Med-Stop has no gender for this driver — order it in Med-Stop." } });
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    }
  });

  it("orders the same reason's alcohol test unobserved, without reading anybody's gender", async () => {
    const { client, calls } = medstop({ gender: null });
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, { ...rtd, service: "alcohol" }, TODAY);
    expect(r).toMatchObject({ payload: { observed: "N", category: "TA" } });
    expect(calls.some((c) => c.path.startsWith("/Employee/"))).toBe(false);
  });

  it("keeps R3 for observed reasons: a name-only match is refused before its gender is read", async () => {
    const { client, calls } = medstop();
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, { ...rtd, medstopId: "EE-NAM" }, TODAY);
    expect(r).toMatchObject({ refusal: { code: "medstop_person_unknown" } });
    expect(calls).toEqual([]);
  });

  it("keeps the live open-order refusal for observed reasons", async () => {
    const { client } = medstop({ open: [{ status: "OPEN", category: "DRUG TEST" }] });
    const r = await prepareOrder(db().client as unknown as SupabaseClient, client, office, ORG, rtd, TODAY);
    expect(r).toMatchObject({ refusal: { code: "medstop_order_open" } });
  });

  it("searches sites for an observer of the donor's gender, and reads no gender for an unobserved test", async () => {
    const { client, calls } = medstop({ gender: "FEMALE" });
    const run = (q: Parameters<typeof siteObservedFor>[3]) => siteObservedFor(db().client as unknown as SupabaseClient, client, ORG, q);
    expect(await run({ reason: "POST-ACCIDENT", service: "drug", medstopId: "EE-ANN" })).toEqual({ observed: "N" });
    expect(await run({ reason: "RETURN TO DUTY", service: "alcohol", medstopId: "EE-ANN" })).toEqual({ observed: "N" });
    expect(calls).toEqual([]);
    expect(await run({ reason: "RETURN TO DUTY", service: "drug", medstopId: "EE-ANN" })).toEqual({ observed: "F", eeid: "EE-ANN" });
    expect(await run({ reason: "FOLLOW-UP", service: "drug" })).toMatchObject({ refusal: { status: 400 } });
    expect(await run({ reason: "FOLLOW-UP", service: "drug", medstopId: "EE-NAM" })).toMatchObject({ refusal: { code: "medstop_person_unknown" } });
    expect(calls.filter((c) => c.path.startsWith("/Employee/"))).toHaveLength(1);
    await findSites(client, { service: "drug", requestDate: "2026-10-15", requestTime: "09:30", observed: "F", eeid: "EE-ANN", zip: "60601" });
    const search = new URL(`https://x${calls.at(-1)!.path}`).searchParams;
    expect([search.get("observed"), search.get("eeid")]).toEqual(["F", "EE-ANN"]);
  });

  it("org-scopes the observed person's roster read", async () => {
    const rec = db();
    await siteObservedFor(rec.client as unknown as SupabaseClient, medstop().client, ORG, { reason: "FOLLOW-UP", service: "drug", medstopId: "EE-ANN" });
    expectOrgScoped(rec, ORG);
  });
});

describe("MedstopClient.write — the allow-list", () => {
  it("refuses every Med-Stop write but POST /Request/new and POST /Employee/new before anything is sent", async () => {
    const { client, calls } = medstop();
    for (const path of ["/Request/REQ-1/notify", "/Test/T-1/result", "/Employee/E-1/remove", "/Employee/E-1/hire", "/Employee/E-1/terminate", "/Request"])
      await expect(client.write("POST", path, {})).rejects.toThrow(/not a Med-Stop write/);
    expect(calls).toHaveLength(0);
  });

  it("allows exactly two writes — an order (UX3) and an applicant (UX5c)", async () => {
    const { MEDSTOP_WRITES } = await import("./client.js");
    expect([...MEDSTOP_WRITES].sort()).toEqual(["POST /Employee/new", "POST /Request/new"]);
  });
});
