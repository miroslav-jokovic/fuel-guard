import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HIRING_PROFILE_V1, type PlatformLead } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { FakeTelnyxLookup } from "../../../testing/fakeTelnyxLookup.js";
import { LOOKUP_RETRY_MAX, lookUpMissingPhones, lookUpPhones, phoneLookupFor, telnyxLookupClient, type PhoneLookupDeps } from "./phoneLookup.js";
import { recruitingLeadSink } from "./leadSink.js";
import { readLead } from "./leadQueue.js";

/**
 * V7a / LQ8b: the phone line-type reader, against a fake Telnyx that answers in the documented shapes and plants
 * the undocumented failures. The database's own half (one row per number, the CHECKs) is 0583's.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-19T15:00:00Z");
const KEY = "KEY-test-telnyx";
const A = "+17082365732";
const B = "+13125550100";
const C = "+16305550199";

const fake = new FakeTelnyxLookup();
beforeAll(async () => { await fake.start(); });
afterAll(async () => { await fake.stop(); });

const client = (timeoutMs = 2_000) => telnyxLookupClient(KEY, { baseUrl: fake.base, timeoutMs });
const deps = (dailyMax = 500, timeoutMs = 2_000): PhoneLookupDeps => ({ client: client(timeoutMs), dailyMax });

/** `phone_lookups` as PostgREST would answer: the rows by filter, the day's count on a head read, writes recorded. */
function lookups(rows: FixtureRow[], opts: { todayCount?: number; insertError?: unknown } = {}) {
  const read = postgrestFixture(rows);
  return (q: RecordedQuery) => {
    if (q.write?.method === "insert" && opts.insertError) return { writeError: opts.insertError };
    if (q.write) return { data: null };
    const head = q.ops.some((o) => o.method === "select" && (o.args[1] as { head?: boolean } | undefined)?.head);
    return head ? { data: null, count: opts.todayCount ?? 0 } : read(q);
  };
}
const writes = (rec: SupabaseRecorder) => rec.queries.filter((q) => q.table === "phone_lookups" && q.write);
const callsFor = (n: string) => fake.calls.filter((c) => c.path === `/v2/number_lookup/${n}`).length;

describe("the Telnyx client reads Telnyx's documented answers", () => {
  it("asks type=carrier only, with the key as a Bearer, the number in the path with its +", async () => {
    const n = "+17085550001";
    const a = await client().lookup(n);
    const call = fake.calls.find((c) => c.path === `/v2/number_lookup/${n}`)!;
    expect([call.query, call.auth]).toEqual(["?type=carrier", `Bearer ${KEY}`]);
    expect(a).toMatchObject({ kind: "answered", projection: { line_type: "mobile", carrier: "T-Mobile", valid: true } });
  });

  it.each([
    ["fixed line", "landline"], ["voip", "voip"], ["fixed line or mobile", "unknown"], ["toll free", "unknown"],
  ] as const)("Telnyx's %s folds to %s", async (type, ours) => {
    const n = `+1708555${String(type.length).padStart(4, "0")}`;
    fake.answer(n, { status: 200, type });
    expect(await client().lookup(n)).toMatchObject({ kind: "answered", projection: { line_type: ours } });
  });

  it("a number Telnyx calls invalid is unknown, with valid false beside it", async () => {
    fake.answer("+17085550002", { status: 200, type: "mobile", valid: false });
    expect(await client().lookup("+17085550002")).toMatchObject({ kind: "answered", projection: { line_type: "unknown", valid: false } });
  });

  it("a 422 is Telnyx refusing THIS number, kept with its error", async () => {
    fake.answer("+17085550003", { status: 422, detail: "+17085550003 is a Canadian number" });
    const a = await client().lookup("+17085550003");
    expect(a.kind).toBe("refused");
    expect(a.kind === "refused" && (a.raw.errors as Array<{ detail: string }>)[0]!.detail).toContain("Canadian");
  });

  it.each([[500], [401], [429], [404]])("an HTTP %i is a failure, never an answer", async (status) => {
    const n = `+170855510${status}`.slice(0, 12);
    fake.answer(n, { status });
    expect(await client().lookup(n)).toEqual({ kind: "failed", reason: `HTTP ${status}` });
  });

  it("a 200 whose body is not Telnyx's shape is a failure", async () => {
    fake.answer("+17085550004", { status: 200, body: { nothing: true } } as never);
    expect((await client().lookup("+17085550004")).kind).toBe("failed");
  });

  it("a Telnyx that never answers is ended by the timeout", async () => {
    fake.answer("+17085550005", { stall: true });
    expect((await client(150).lookup("+17085550005")).kind).toBe("failed");
  });

  it("refuses anything that is not E.164 without calling", async () => {
    const before = fake.calls.length;
    expect(await client().lookup("7085550006/../../v2/messages")).toEqual({ kind: "failed", reason: "not an E.164 number" });
    expect(fake.calls.length).toBe(before);
  });
});

describe("lookUpPhones writes one row per number, and only what Telnyx answered", () => {
  it("a new number is inserted whole, scoped to the carrier", async () => {
    fake.answer(A, { status: 200, type: "voip", carrier: "Bandwidth" });
    const rec = createSupabaseRecorder({ tables: { phone_lookups: lookups([]) } });
    const run = await lookUpPhones(rec.client as never, ORG, [A, A, null], deps(), NOW);
    expect(run).toMatchObject({ asked: 1, stored: 1, failed: 0 });
    const [w] = writes(rec);
    expect(w!.write).toEqual({ method: "insert", payload: expect.objectContaining({ org_id: ORG, phone_e164: A, provider: "telnyx", line_type: "voip", carrier: "Bandwidth", valid: true, looked_up_at: NOW.toISOString() }) });
    expectOrgScoped(rec, ORG);
  });

  it("a fresh row is not asked again; a row past 180 days is asked and REPLACED", async () => {
    const fresh = { org_id: ORG, id: "l1", phone_e164: A, looked_up_at: "2026-10-01T00:00:00Z" };
    const stale = { org_id: ORG, id: "l2", phone_e164: B, looked_up_at: "2026-04-01T00:00:00Z" };
    const before = [callsFor(A), callsFor(B)];
    const rec = createSupabaseRecorder({ tables: { phone_lookups: lookups([fresh, stale]) } });
    const run = await lookUpPhones(rec.client as never, ORG, [A, B], deps(), NOW);
    expect([callsFor(A) - before[0]!, callsFor(B) - before[1]!]).toEqual([0, 1]);
    expect(run).toMatchObject({ fresh: 1, stored: 1 });
    expect(writes(rec).map((q) => q.write!.method)).toEqual(["update"]);
    expect(writes(rec)[0]!.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "phone_e164", val: B }]));
  });

  it("at the day's ceiling nothing is asked; the number waits", async () => {
    const before = callsFor(C);
    const rec = createSupabaseRecorder({ tables: { phone_lookups: lookups([], { todayCount: 3 }) } });
    const run = await lookUpPhones(rec.client as never, ORG, [C], deps(3), NOW);
    expect([run.over_quota, run.asked, callsFor(C) - before, writes(rec).length]).toEqual([1, 0, 0, 0]);
  });

  it("the ceiling counts the lookups made in this run too", async () => {
    const rec = createSupabaseRecorder({ tables: { phone_lookups: lookups([], { todayCount: 1 }) } });
    const run = await lookUpPhones(rec.client as never, ORG, ["+17085550010", "+17085550011", "+17085550012"], deps(2), NOW);
    expect([run.stored, run.over_quota]).toEqual([1, 2]);
  });

  it("a 422 is stored as unknown with Telnyx's error, so it is not asked every five minutes", async () => {
    fake.answer("+17085550020", { status: 422 });
    const rec = createSupabaseRecorder({ tables: { phone_lookups: lookups([]) } });
    const run = await lookUpPhones(rec.client as never, ORG, ["+17085550020"], deps(), NOW);
    expect(run.refused).toBe(1);
    expect(writes(rec)[0]!.write!.payload).toMatchObject({ line_type: "unknown", valid: null, carrier: null, raw: { http_status: 422 } });
  });

  it("a failure writes nothing, so the sweep asks again", async () => {
    fake.answer("+17085550021", { status: 503 });
    const rec = createSupabaseRecorder({ tables: { phone_lookups: lookups([]) } });
    const run = await lookUpPhones(rec.client as never, ORG, ["+17085550021"], deps(), NOW);
    expect([run.failed, writes(rec).length]).toEqual([1, 0]);
  });

  it("a number another lead stored in the meantime (23505) is replaced, not lost", async () => {
    const rec = createSupabaseRecorder({ tables: { phone_lookups: lookups([], { insertError: { code: "23505", message: "duplicate key" } }) } });
    await lookUpPhones(rec.client as never, ORG, ["+17085550022"], deps(), NOW);
    expect(writes(rec).map((q) => q.write!.method)).toEqual(["insert", "update"]);
  });

  it("any other write failure throws, for the caller to decide", async () => {
    const rec = createSupabaseRecorder({ tables: { phone_lookups: lookups([], { insertError: { code: "42501", message: "denied" } }) } });
    await expect(lookUpPhones(rec.client as never, ORG, ["+17085550023"], deps(), NOW)).rejects.toThrow(/Could not store/);
  });
});

describe("the deployment's switch", () => {
  it("is off with no key, and off at a ceiling of 0", () => {
    expect(phoneLookupFor({ TELNYX_API_KEY: undefined, TELNYX_LOOKUP_DAILY_MAX: 500 })).toBeNull();
    expect(phoneLookupFor({ TELNYX_API_KEY: KEY, TELNYX_LOOKUP_DAILY_MAX: 0 })).toBeNull();
    expect(phoneLookupFor({ TELNYX_API_KEY: KEY, TELNYX_LOOKUP_DAILY_MAX: 500 })?.dailyMax).toBe(500);
  });
});

describe("the sink looks the number up after the store and the ring, and never fails for it", () => {
  const OPENING = "60000000-0000-4000-8000-000000000001";
  const PV = "70000000-0000-4000-8000-000000000001";
  const lead: PlatformLead = {
    provider: "meta", platform_lead_ref: "778", campaign_id: "00000000-0000-4000-8000-00000000aa01", brief_source: "recruiting_opening",
    brief_ref: `${OPENING}@v2`, created_at: "2026-11-19T14:00:00+00:00", answers: { full_name: "Ray Driver", phone_number: "(630) 555-0199" },
    raw: { id: "778" },
  };
  const timeline: string[] = [];
  const seed = (phoneLookups: unknown) => createSupabaseRecorder({
    tables: {
      recruiting_leads: [],
      recruiting_openings: postgrestFixture([{ org_id: ORG, id: OPENING, recruiter_id: null }]),
      recruiting_opening_versions: postgrestFixture([{ org_id: ORG, opening_id: OPENING, version: 2, profile_version_id: PV }]),
      hiring_profile_versions: postgrestFixture([{ org_id: ORG, id: PV, requirements: HIRING_PROFILE_V1 }]),
      lead_match_verdicts: (q: RecordedQuery) => (q.write?.method === "insert" ? { data: q.write.payload } : []),
      memberships: [],
      phone_lookups: (q: RecordedQuery) => {
        timeline.push("phone_lookups");
        return typeof phoneLookups === "function" ? phoneLookups(q) : phoneLookups;
      },
    },
    rpc: (fn) => (timeline.push(fn), fn === "ingest_lead" ? { lead_id: "50000000-0000-4000-8000-000000000009", stored: "new", matches: { leads: [], drivers: [] } } : null),
  });

  it("rings first, then stores the lookup", async () => {
    timeline.length = 0;
    const rec = seed(lookups([]));
    const sink = recruitingLeadSink(rec.client as never, async () => ["u-dana"], () => NOW, deps());
    const r = await sink.accept(ORG, lead);
    expect(r.stored).toBe("new");
    expect(writes(rec).length).toBe(1);
    const rang = timeline.indexOf("emit_notification");
    expect(rang).toBeGreaterThan(timeline.indexOf("ingest_lead"));
    expect(timeline.indexOf("phone_lookups")).toBeGreaterThan(rang);
    expectOrgScoped(rec, ORG);
  });

  it("a lookup table that cannot be read still accepts the lead", async () => {
    const rec = seed({ error: { message: "boom" } });
    const sink = recruitingLeadSink(rec.client as never, async () => ["u-dana"], () => NOW, deps());
    await expect(sink.accept(ORG, lead)).resolves.toMatchObject({ stored: "new" });
  });

  it("with the lookup off, nothing is asked", async () => {
    const rec = seed(lookups([]));
    await recruitingLeadSink(rec.client as never, async () => ["u-dana"], () => NOW).accept(ORG, lead);
    expect(rec.queries.filter((q) => q.table === "phone_lookups")).toEqual([]);
  });
});

describe("the sweep's retry", () => {
  /**
   * APPLY-PAGE-PLAN D-AP5: a careers-page submission a robot check flagged is not paid for while nobody has worked it
   * — a bot can type a stranger's number. Once a recruiter moves it past `new` it is looked up like any lead, and a
   * number that also sits on a clean lead is looked up regardless. Through the select's JSON path, as PostgREST reads it.
   */
  it("skips a flagged lead nobody has worked, and looks up a worked one and any number a clean lead shares", async () => {
    const flags = (f: string[]) => ({ checks: { flags: f } });
    const leads = [
      { org_id: ORG, id: "a", status: "new", phone_e164: "+17085550001", raw: flags(["too_fast"]), received_at: "2026-11-19T00:00:00Z" },
      { org_id: ORG, id: "b", status: "contacted", phone_e164: "+17085550002", raw: flags(["too_fast"]), received_at: "2026-11-19T00:00:00Z" },
      { org_id: ORG, id: "c", status: "new", phone_e164: "+17085550003", raw: flags([]), received_at: "2026-11-19T00:00:00Z" },
      { org_id: ORG, id: "d", status: "new", phone_e164: "+17085550003", raw: flags(["honeypot_filled"]), received_at: "2026-11-19T00:00:00Z" },
    ];
    const rec = createSupabaseRecorder({ tables: { recruiting_leads: postgrestFixture(leads), phone_lookups: lookups([]) } });
    const run = await lookUpMissingPhones(rec.client as never, ORG, deps(10_000), NOW);
    expect(run.asked).toBe(2);
    const asked = writes(rec).map((q) => (q.write!.payload as { phone_e164: string }).phone_e164).sort();
    expect(asked).toEqual(["+17085550002", "+17085550003"]);
    expectOrgScoped(rec, ORG);
  });

  it("asks only the recent numbers with no fresh row, at most LOOKUP_RETRY_MAX", async () => {
    const leads = Array.from({ length: LOOKUP_RETRY_MAX + 5 }, (_, i) => ({ phone_e164: `+1708556${String(i).padStart(4, "0")}` }));
    const freshOne = { org_id: ORG, id: "x", phone_e164: leads[0]!.phone_e164, line_type: "mobile", valid: true, carrier: null, looked_up_at: "2026-11-18T00:00:00Z" };
    const rec = createSupabaseRecorder({ tables: { recruiting_leads: leads, phone_lookups: lookups([freshOne]) } });
    const run = await lookUpMissingPhones(rec.client as never, ORG, deps(10_000), NOW);
    expect(run.asked).toBe(LOOKUP_RETRY_MAX);
    expect(writes(rec).some((q) => (q.write!.payload as { phone_e164: string }).phone_e164 === leads[0]!.phone_e164)).toBe(false);
    const leadRead = rec.queries.find((q) => q.table === "recruiting_leads")!;
    expect(leadRead.ops.find((o) => o.method === "gte")!.args).toEqual(["received_at", "2026-11-12T15:00:00.000Z"]);
    expectOrgScoped(rec, ORG);
  });
});

describe("a lead read carries its number's line", () => {
  it("joined by number; null while not looked up", async () => {
    const LEAD = "50000000-0000-4000-8000-000000000010";
    const row = { org_id: ORG, id: LEAD, channel: "meta_lead_ads", phone_e164: A, email_lower: null, status: "new", answers: {}, purged_at: null };
    const line = { org_id: ORG, phone_e164: A, line_type: "landline", valid: true, carrier: "AT&T", looked_up_at: "2026-11-19T14:00:00Z" };
    const make = (lines: FixtureRow[]) => createSupabaseRecorder({
      tables: { recruiting_leads: postgrestFixture([row]), phone_lookups: postgrestFixture(lines), lead_match_verdicts: [], sms_suppressions: [] },
      rpc: (fn) => (fn === "recruiting_lead_matches" ? { leads: [], drivers: [] } : null),
    });
    const withLine = await readLead(make([line]).client as never, ORG, LEAD);
    expect(withLine!.phone_line).toEqual({ line_type: "landline", valid: true, carrier: "AT&T", looked_up_at: "2026-11-19T14:00:00Z" });
    expect((await readLead(make([]).client as never, ORG, LEAD))!.phone_line).toBeNull();
  });
});
