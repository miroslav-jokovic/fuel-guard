import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HIRING_PROFILE_V1, SMS_APPLY_PAGE_CONSENT, type ApplyJobView, type CareersListView, type LeadProjection } from "@silvicom/shared";
import { loadEnv, type Env } from "../../../env.js";
import { setAppLocals } from "../../../lib/appLocals.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import type { FetchLike } from "../careers/applyChecks.js";

/**
 * AP2 (APPLY-PAGE-PLAN): the careers page's three public doors, end to end over HTTP — what a stranger may see, what a
 * submission becomes, which checks flag it, and what the texting box records. The LeadSink itself is mocked to its
 * boundary (what it is handed, and with `quiet` or not): its own road is `leads/leadSink.test.ts`.
 */

const holder = vi.hoisted(() => ({
  client: null as unknown,
  accepted: [] as Array<{ orgId: string; projection: LeadProjection; lookup: unknown; quiet: boolean }>,
  stored: "new" as "new" | "duplicate",
}));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
vi.mock("../leads/leadSink.js", () => ({
  acceptLeadProjection: vi.fn(async (_a: unknown, _c: unknown, _clock: unknown, lookup: unknown, orgId: string, projection: LeadProjection, opts: { quiet?: boolean } = {}) => {
    holder.accepted.push({ orgId, projection, lookup, quiet: Boolean(opts.quiet) });
    return { stored: holder.stored, ref: LEAD, contactable: true };
  }),
}));

import { publicCareersRouter } from "./publicCareers.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OPENING = "60000000-0000-4000-8000-000000000001";
const NOMAX = "60000000-0000-4000-8000-000000000002";
const OTHER_OPENING = "60000000-0000-4000-8000-000000000003";
const PV = "70000000-0000-4000-8000-000000000001";
const LEAD = "50000000-0000-4000-8000-000000000001";
const PHONE = "+17082365732";
const SECRET = Buffer.alloc(32, 7).toString("base64");
const KEYS = { TURNSTILE_SITE_KEY: "0x4AAAAAAAsite", TURNSTILE_SECRET_KEY: "0x4AAAAAAAsecret" };

const facts = (max: number | null) => ({
  pay: { per: "mile", min_cents: 60, max_cents: max }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null,
  benefits: ["health insurance"], bonus: null, schedule: "regional", in_our_words: null,
});
// The profile asks Class A, years (floor 2) and — required here — hazmat: three questions.
const REQUIREMENTS = { ...HIRING_PROFILE_V1, hazmat: { mode: "required", reason: "Hazmat loads are most of this lane's freight." } };
const ANSWERS = { class_a_held: "yes", class_a_years: "2to5", hazmat_endorsement: "yes" };

interface Seed {
  pageEnabled?: boolean;
  suppressed?: boolean;
  busy?: { ip?: number; phone?: number };
  existingConsent?: boolean;
  storedRaw?: unknown;
}
let rec: SupabaseRecorder;
function seed(o: Seed = {}): SupabaseRecorder {
  rec = createSupabaseRecorder({
    tables: {
      recruiting_careers_pages: postgrestFixture([
        { org_id: ORG, handle: "silvicom", enabled: o.pageEnabled ?? true, accommodation_email: "recruiting@silvicominc.com", accommodation_phone: null },
        { org_id: OTHER, handle: "other-carrier", enabled: true, accommodation_email: null, accommodation_phone: "+13125550100" },
      ]),
      organizations: postgrestFixture([{ id: ORG, name: "Silvicom Inc" }, { id: OTHER, name: "Other Carrier LLC" }]),
      recruiting_openings: postgrestFixture([
        { org_id: ORG, id: OPENING, status: "open", created_at: "2026-11-01T00:00:00Z", recruiter_id: null },
        { org_id: ORG, id: NOMAX, status: "open", created_at: "2026-11-02T00:00:00Z", recruiter_id: null },
        { org_id: OTHER, id: OTHER_OPENING, status: "open", created_at: "2026-11-03T00:00:00Z", recruiter_id: null },
      ]),
      recruiting_opening_versions: postgrestFixture([
        { org_id: ORG, id: "v1", opening_id: OPENING, version: 1, profile_version_id: PV, title: "Regional dry van", facts: facts(75), area_label: "Chicago, IL" },
        { org_id: ORG, id: "v2", opening_id: NOMAX, version: 1, profile_version_id: PV, title: "OTR reefer", facts: facts(null), area_label: "Joliet, IL" },
        { org_id: OTHER, id: "v3", opening_id: OTHER_OPENING, version: 1, profile_version_id: PV, title: "Theirs", facts: facts(90), area_label: "Gary, IN" },
      ]),
      hiring_profile_versions: postgrestFixture([{ org_id: ORG, id: PV, requirements: REQUIREMENTS }]),
      recruiting_leads: (q: RecordedQuery) => {
        if (q.ops.some((op) => op.method === "select" && (op.args[1] as { head?: boolean } | undefined)?.head)) {
          const byIp = q.filters().some((f) => f.col === "raw->client->>ip");
          return { data: null, count: byIp ? (o.busy?.ip ?? 0) : (o.busy?.phone ?? 0) };
        }
        return [{ org_id: ORG, id: LEAD, raw: o.storedRaw ?? {}, phone_e164: PHONE }];
      },
      sms_suppressions: postgrestFixture(o.suppressed ? [{ org_id: ORG, phone: PHONE, lifted_at: null }] : []),
      sms_consents: (q: RecordedQuery) => (q.write ? { data: null } : o.existingConsent ? [{ id: "c-1" }] : []),
    },
  });
  holder.client = rec.client;
  return rec;
}

let server: Server;
let baseUrl: string;
let env: Env;
let turnstileAnswer: unknown = { success: true, hostname: "360.example.test", action: "apply", "error-codes": [] };
const siteverifyCalls: URLSearchParams[] = [];
const fetchImpl: FetchLike = async (_url, init) => {
  siteverifyCalls.push(init.body);
  return { ok: true, status: 200, json: async () => turnstileAnswer };
};

async function start(extra: Record<string, string> = KEYS) {
  if (server) await closeTestServer(server);
  // Telnyx's key is set so a clean lead HAS a lookup to hand the sink — otherwise "flagged gets none" proves nothing.
  env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: SECRET, WEB_APP_URL: "https://360.example.test", TELNYX_API_KEY: "KEY_test", ...extra } as NodeJS.ProcessEnv);
  const app = express();
  setAppLocals(app, { env });
  app.use(express.json());
  app.use("/api/public/careers", publicCareersRouter({ recipientsFor: () => async () => ["u-dana"], fetchImpl }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
}
beforeAll(() => start());
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  holder.accepted = [];
  holder.stored = "new";
  siteverifyCalls.length = 0;
  turnstileAnswer = { success: true, hostname: "360.example.test", action: "apply", "error-codes": [] };
});

const get = (path: string) => fetch(`${baseUrl}/api/public/careers${path}`);
const job = async (): Promise<ApplyJobView> => (await (await get(`/silvicom/jobs/${OPENING}`)).json()) as ApplyJobView;
/** A real served form, sent `waitMs` later by moving the clock — the fill time is the server's, never the browser's. */
async function apply(body: Record<string, unknown> = {}, opts: { waitMs?: number; opening?: string; handle?: string } = {}) {
  const view = await job();
  vi.useFakeTimers({ now: Date.now() + (opts.waitMs ?? 30_000), toFake: ["Date"] });
  try {
    return await fetch(`${baseUrl}/api/public/careers/${opts.handle ?? "silvicom"}/jobs/${opts.opening ?? OPENING}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        formToken: view.formToken, fullName: "Ray Driver", phone: "(708) 236-5732", email: "Ray@Example.com", answers: ANSWERS,
        smsOptIn: false, turnstileToken: "tok", company_website: "", ...body,
      }),
    });
  } finally {
    vi.useRealTimers();
  }
}
const accepted = () => holder.accepted[0]!;
const checks = () => (accepted().projection.raw as { checks: { flags: string[]; turnstile: string; fill: string; honeypot: string } }).checks;
const consentInserts = () => rec.writtenRows("sms_consents");

describe("what a stranger may see", () => {
  it("the list: only this carrier's published openings — the top of the pay range is the rule — and no-store", async () => {
    seed();
    const res = await get("/silvicom");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const v = (await res.json()) as CareersListView;
    expect(v.carrier).toBe("Silvicom Inc");
    expect(v.accommodation).toEqual({ email: "recruiting@silvicominc.com", phone: null });
    expect(v.openings.map((o) => o.id)).toEqual([OPENING]);
    expect(v.openings[0]).toMatchObject({ title: "Regional dry van", areaLabel: "Chicago, IL", pay: { per: "mile", min_cents: 60, max_cents: 75 } });
    // D-AP9: with no careers host set, both the page and the legal pages are the office host's.
    expect([v.pageUrl, v.legalOrigin]).toEqual(["https://360.example.test/careers/silvicom", "https://360.example.test"]);
  });

  it("on a server with a careers host (D-AP9): the pages name it, the legal pages stay on the office host, the lead records it", async () => {
    await start({ ...KEYS, CAREERS_URL: "https://careers.example.test", WEB_APP_URL: "https://360.example.test/" });
    try {
      seed();
      const list = (await (await get("/silvicom")).json()) as CareersListView;
      expect([list.pageUrl, list.legalOrigin]).toEqual(["https://careers.example.test/careers/silvicom", "https://360.example.test"]);
      seed();
      const job = (await (await get(`/silvicom/jobs/${OPENING}`)).json()) as ApplyJobView;
      expect([job.pageUrl, job.legalOrigin]).toEqual([`https://careers.example.test/careers/silvicom/jobs/${OPENING}`, "https://360.example.test"]);
    } finally {
      await start();
    }
  });

  it("a page that is off, a handle nobody holds, and a handle people cannot type all answer the same 404", async () => {
    for (const path of ["/nobody", "/Silvicom", "/a"]) {
      seed();
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: { code: "not_found", message: "This careers page or job is not available." } });
    }
    // Not even asked about: a handle that cannot exist never reaches the database.
    seed();
    await get("/Silvicom");
    await get("/a");
    expect(rec.forTable("recruiting_careers_pages")).toHaveLength(0);
    seed({ pageEnabled: false });
    expect((await get("/silvicom")).status).toBe(404);
    expect(rec.forTable("recruiting_openings")).toHaveLength(0);
  });

  it("the job: its facts, its requirements, the profile's questions in the catalogue's words, the box's words, a token, the site key", async () => {
    seed();
    const res = await get(`/silvicom/jobs/${OPENING}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const v = (await res.json()) as ApplyJobView;
    expect(v.opening).toMatchObject({ id: OPENING, title: "Regional dry van", areaLabel: "Chicago, IL" });
    expect(v.opening.facts.benefits).toEqual(["health insurance"]);
    expect(v.requirements).toEqual({ minAge: 23, minClassAYears: 2, hazmat: "required" });
    expect(v.questions.map((q) => q.key)).toEqual(["class_a_held", "class_a_years", "hazmat_endorsement"]);
    expect(v.questions[0]).toEqual({ key: "class_a_held", label: "Do you hold a valid Class A CDL?", options: [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] });
    expect(v.consent.version).toBe(SMS_APPLY_PAGE_CONSENT.version);
    expect(v.consent.body).toContain("text messages from Silvicom Inc at the mobile number above");
    expect(v.consent.body).not.toContain("{{carrier}}");
    expect(typeof v.formToken).toBe("string");
    expect(v.turnstileSiteKey).toBe("0x4AAAAAAAsite");
    // The handle lookup is the one query not scoped to an org; every other one is.
    const byHandle = rec.forTable("recruiting_careers_pages");
    expect(byHandle).toHaveLength(1);
    expectOrgScoped({ ...rec, queries: rec.queries.filter((q) => !byHandle.includes(q) && q.table !== "organizations") }, ORG);
  });

  it("an opening with no pay top, another carrier's opening, and a malformed id are each the same 404", async () => {
    for (const id of [NOMAX, OTHER_OPENING, "not-an-id"]) {
      seed();
      expect((await get(`/silvicom/jobs/${id}`)).status, id).toBe(404);
    }
  });
});

describe("what a submission becomes", () => {
  it("a clean one: a lead through the LeadSink, channel apply_page, the served form's id, the catalogue answers, NOT quiet", async () => {
    seed();
    const res = await apply();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(holder.accepted).toHaveLength(1);
    const { orgId, projection, quiet } = accepted();
    expect(orgId).toBe(ORG);
    expect(quiet).toBe(false);
    expect(accepted().lookup).not.toBeNull();
    expect(projection).toMatchObject({
      channel: "apply_page", source: "careers_page", opening_id: OPENING, campaign_ref: null,
      answers: ANSWERS, full_name: "Ray Driver", phone_e164: PHONE, email_lower: "ray@example.com",
    });
    expect(projection.external_ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(checks()).toMatchObject({ turnstile: "passed", fill: "ok", honeypot: "empty", flags: [] });
    expect((projection.raw as { page: { url: string } }).page.url).toBe(`https://360.example.test/careers/silvicom/jobs/${OPENING}`);
  });

  it("the same form sent twice is the same external ref, so the LeadSink stores it once; the second answers 200", async () => {
    seed();
    const view = await job();
    const send = async () => {
      vi.useFakeTimers({ now: Date.now() + 30_000, toFake: ["Date"] });
      try {
        return await fetch(`${baseUrl}/api/public/careers/silvicom/jobs/${OPENING}/apply`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ formToken: view.formToken, fullName: "Ray Driver", phone: PHONE, email: null, answers: ANSWERS, smsOptIn: false, turnstileToken: "tok", company_website: "" }),
        });
      } finally {
        vi.useRealTimers();
      }
    };
    await send();
    holder.stored = "duplicate";
    expect((await send()).status).toBe(200);
    expect(holder.accepted[0]!.projection.external_ref).toBe(holder.accepted[1]!.projection.external_ref);
  });

  it("stores no field the contract does not have: an extra key is refused before anything is stored", async () => {
    seed();
    for (const extra of [{ ssn: "000-12-3456" }, { criminal_history: "no" }, { date_of_birth: "1990-01-01" }]) {
      const res = await apply(extra);
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(holder.accepted).toHaveLength(0);
  });

  it("refuses, by field, what the page itself would never send: a missing answer, an answer not offered, a question not asked, no way to reach them", async () => {
    seed();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ answers: { class_a_held: "yes", class_a_years: "2to5" } }, "answers"],
      [{ answers: { ...ANSWERS, class_a_held: "maybe" } }, "answers"],
      [{ answers: { ...ANSWERS, tanker_endorsement: "yes" } }, "answers"],
      [{ phone: null, email: null }, "phone"],
      [{ phone: "12345" }, "phone"],
      [{ email: "not-an-email" }, "email"],
      [{ phone: null, smsOptIn: true }, "phone"],
    ];
    for (const [body, field] of cases) {
      const res = await apply(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: { field: string } }).error.field, JSON.stringify(body)).toBe(field);
    }
    expect(holder.accepted).toHaveLength(0);
  });

  it("a page that went off or an opening that lost its pay top between showing and sending: 404, nothing stored", async () => {
    seed({ pageEnabled: false });
    expect((await apply()).status).toBe(404);
    seed();
    expect((await apply({}, { opening: NOMAX })).status).toBe(404);
    expect(holder.accepted).toHaveLength(0);
  });
});

describe("the checks flag; they never refuse (D-AP5)", () => {
  const flagged = async (body: Record<string, unknown>, s: Seed = {}, waitMs?: number) => {
    seed(s);
    holder.accepted = [];
    const res = await apply(body, waitMs === undefined ? {} : { waitMs });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    return { flags: checks().flags, quiet: accepted().quiet, lookup: accepted().lookup };
  };

  it("each failed check is stored as its flag, the answer says nothing different, and the lead is quiet with no lookup", async () => {
    turnstileAnswer = { success: false, "error-codes": ["invalid-input-response"] };
    expect(await flagged({})).toEqual({ flags: ["robot_check_failed"], quiet: true, lookup: null });
    turnstileAnswer = { success: true, hostname: "360.example.test", action: "apply" };
    expect((await flagged({ turnstileToken: null })).flags).toEqual(["robot_check_missing"]);
    expect((await flagged({ company_website: "https://spam.example" })).flags).toEqual(["honeypot_filled"]);
    expect((await flagged({}, {}, 1_500)).flags).toEqual(["too_fast"]);
    expect((await flagged({ formToken: "v1.forged.token.x.y" })).flags).toEqual(["form_token_invalid"]);
    expect((await flagged({}, { busy: { ip: 5 } })).flags).toEqual(["address_busy"]);
    expect((await flagged({}, { busy: { phone: 3 } })).flags).toEqual(["number_busy"]);
  });

  it("one under each limit is not busy", async () => {
    expect((await flagged({}, { busy: { ip: 4, phone: 2 } })).flags).toEqual([]);
  });

  it("Turnstile is asked with the token, the caller's address and the served form's id", async () => {
    seed();
    await apply();
    expect(siteverifyCalls).toHaveLength(1);
    expect(siteverifyCalls[0]!.get("response")).toBe("tok");
    expect(siteverifyCalls[0]!.get("remoteip")).toMatch(/127\.0\.0\.1/);
    expect(siteverifyCalls[0]!.get("idempotency_key")).toBe(accepted().projection.external_ref);
  });

  it("with no Turnstile keys, nothing is asked and nothing is flagged for it: not checked, and the bell rings", async () => {
    await start({});
    try {
      seed();
      expect((await job()).turnstileSiteKey).toBeNull();
      await apply({ turnstileToken: null });
      expect(siteverifyCalls).toHaveLength(0);
      expect(checks()).toMatchObject({ turnstile: "not_configured", flags: [] });
      expect(accepted().quiet).toBe(false);
    } finally {
      await start();
    }
  });
});

describe("the texting box (D-AP4)", () => {
  const smsOf = () => (accepted().projection.raw as { sms: unknown }).sms;

  it("ticked on a clean submission: one consent row on the LEAD, in the served words, with the proof", async () => {
    seed();
    await apply({ smsOptIn: true });
    expect(smsOf()).toEqual({ ticked: true, outcome: "recorded", consent_version: "apply-page-2026-11-20" });
    expect(consentInserts()).toEqual([expect.objectContaining({
      org_id: ORG, lead_id: LEAD, phone: PHONE, source: "lead_form", consent_version: "apply-page-2026-11-20",
      consent_text: expect.stringContaining("text messages from Silvicom Inc"), intent_statement: "Text me about my application.",
      granted_ip: expect.stringMatching(/127\.0\.0\.1/), granted_user_agent: expect.any(String),
    })]);
    expect(consentInserts()[0]).not.toHaveProperty("driver_id");
    expectOrgScoped({ ...rec, queries: rec.queries.filter((q) => q.table !== "recruiting_careers_pages" && q.table !== "organizations") }, ORG);
  });

  it("not ticked: no row, and the lead says so", async () => {
    seed();
    await apply();
    expect(smsOf()).toEqual({ ticked: false, outcome: "not_ticked", consent_version: null });
    expect(consentInserts()).toHaveLength(0);
  });

  it("ticked on a FLAGGED submission: held, not recorded — a bot can type a stranger's number", async () => {
    seed();
    await apply({ smsOptIn: true, company_website: "x" });
    expect(smsOf()).toMatchObject({ ticked: true, outcome: "held_flagged" });
    expect(consentInserts()).toHaveLength(0);
  });

  it("ticked for a number that texted STOP here: held, not recorded — a box must not overrule a STOP", async () => {
    seed({ suppressed: true });
    await apply({ smsOptIn: true });
    expect(smsOf()).toMatchObject({ ticked: true, outcome: "held_stopped" });
    expect(consentInserts()).toHaveLength(0);
  });

  it("the same form sent again: the FIRST send's stored outcome decides, and a row already there is not written twice", async () => {
    holder.stored = "duplicate";
    seed({ storedRaw: { sms: { outcome: "held_flagged" } } });
    await apply({ smsOptIn: true });
    expect(consentInserts()).toHaveLength(0);
    seed({ storedRaw: { sms: { outcome: "recorded" } }, existingConsent: true });
    await apply({ smsOptIn: true });
    expect(consentInserts()).toHaveLength(0);
    // A first send whose consent write failed is healed by the retry.
    seed({ storedRaw: { sms: { outcome: "recorded" } } });
    await apply({ smsOptIn: true });
    expect(consentInserts()).toHaveLength(1);
  });
});
