import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SMS_CONSENT } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { hashInvitationToken } from "../applicationIntake.js";

/**
 * The applicant agreeing to be texted, end to end (SMS-OPT-IN-PLAN SMS1).
 *
 * What is pinned: no tenant crosses the boundary, the ESIGN consent comes first, draft wording takes
 * nothing, a double press is one agreement and one confirmation, the answer carries four digits and
 * never the number, and withdrawing works whatever the wording's state.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const sms = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../../lib/sms.js", async (orig) => ({
  ...(await orig<typeof import("../../../lib/sms.js")>()),
  sendSms: sms.fn,
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const TOKEN = "c".repeat(43);

let server: Server;
let baseUrl: string;
let seq = 0;
const call = (path: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/public/application/${TOKEN}${path}`, {
    ...init,
    // A distinct address per call — the surface is rate limited per IP (see publicApplication.test.ts).
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(seq++ % 250) + 1}`, ...(init.headers ?? {}) },
  });
const agree = (phone = "(708) 236-5732") =>
  call("/sms-consent", { method: "POST", body: JSON.stringify({ phone, agreed: true }) });

/** Counsel's wording, published for one test — the only way past `isDraftSmsConsent`. */
const publish = () => vi.spyOn(SMS_CONSENT, "version", "get").mockReturnValue("v1");
/** The wording withdrawn to a draft — the state before D-SMS10, and the one a redline could return to. */
const draft = () => vi.spyOn(SMS_CONSENT, "version", "get").mockReturnValue("v0-draft");

type Row = Record<string, unknown>;
/** The fields these tests read off an answer — every route here returns a subset of them. */
interface Answer {
  document?: { body: string };
  status?: Row;
  confirmation?: string | null;
  error?: { code: string };
}
const read = async (res: Response): Promise<Answer> => (await res.json()) as Answer;

/**
 * A link, and whatever `sms_consents` holds. A function fixture with state: once the insert lands,
 * later READS see the new row — which is what the confirmation's own consent check reads. A flat
 * array would answer the read before and after the insert identically, and the send would be held
 * on `no_consent` for a reason no production request could produce.
 *
 * Reads go through `postgrestFixture` since C2d2: the cap on numbers counts a link's consents by date,
 * and a flat answer would count every row whatever the query asked.
 */
const seed = (consents: Row[] = [], invitation: Row = {}, suppressions: Row[] = []) => {
  let rows: Row[] = consents.map((r) => ({ org_id: ORG, driver_id: DRIVER, revoked_at: null, ...r }));
  return createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: "inv-1", org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null, consented_at: "2026-09-14T08:00:00Z",
        ...invitation,
      }],
      organizations: [{ name: "Silvicom Inc" }],
      sms_consents: (q: RecordedQuery) => {
        if (q.write?.method !== "insert") return postgrestFixture(rows)(q);
        const inserted = { id: "c-new", granted_at: "2026-09-25T20:00:00Z", revoked_at: null, ...(q.write.payload as Row) };
        rows = [inserted, ...rows];
        return [inserted];
      },
      // C2d: the confirmation goes through the outbox, which records every text it sends or queues.
      sms_outbox: (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: "o-1" }] : []),
      application_intakes: [],
      sms_suppressions: postgrestFixture(suppressions),
    },
    rpc: { revoke_sms_consent: 1 },
  });
};
/** The token lookup cannot carry an org — the token is what finds it; and the org row is read BY its id. */
const TOKEN_LOOKUP = { exempt: ["application_invitations", "organizations"] };

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
/**
 * ⚠ A default send that succeeds, for every test (found 2026-09-27, C3c2c). Agreeing sends a
 * confirmation — or queues it outside the all-US civil window — and most tests here run on the REAL
 * clock. `afterEach` resets the mock to return nothing, so from 18:00 UTC (08:00 in Hawaii, the window
 * opening) until 01:00 UTC the confirmation was SENT through a mock returning `undefined`, `transmit`
 * threw, and three tests about consent counting failed with a 500; before 18:00 they passed, which is
 * when CI had happened to run. A test that needs a failed or checked send still sets its own.
 */
beforeEach(() => {
  sms.fn.mockResolvedValue({ ok: true, provider: "telnyx", messageId: "m-default" });
});
afterEach(() => {
  vi.restoreAllMocks();
  sms.fn.mockReset();
});

describe("reading the card", () => {
  it("serves the wording with the carrier named, and says it is not offered while draft", async () => {
    draft();
    const rec = seed();
    holder.client = rec.client;
    const res = await call("/sms-consent");
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.document?.body).toContain("Silvicom Inc");
    expect(body.status).toEqual({ offered: false, state: "none", phoneLast4: null, grantedAt: null, revokedAt: null });
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);
  });

  it("answers a live consent with the last four digits and never the number", async () => {
    publish();
    holder.client = seed([{ phone: "+17082365732", granted_at: "2026-09-25T10:00:00Z", revoked_at: null }]).client;
    const body = await read(await call("/sms-consent"));
    expect(body.status).toMatchObject({ offered: true, state: "agreed", phoneLast4: "5732" });
    expect(JSON.stringify(body)).not.toContain("7082365732");
  });

  /**
   * ⚠ A stopped newer number beside a live older one reads `agreed`, because the sender would text
   * the older one. Reporting "stopped" here would be a screen contradicting the send path.
   */
  it("reports what the sender would do when one number is stopped and another is live", async () => {
    publish();
    holder.client = seed([
      { phone: "+13125550100", granted_at: "2026-09-25T10:00:00Z", revoked_at: "2026-09-25T11:00:00Z" },
      { phone: "+17082365732", granted_at: "2026-09-20T10:00:00Z", revoked_at: null },
    ]).client;
    const body = await read(await call("/sms-consent"));
    expect(body.status).toMatchObject({ state: "agreed", phoneLast4: "5732", revokedAt: null });
  });

  it("answers a dead link the way every dead link is answered", async () => {
    holder.client = seed([], { revoked_at: "2026-09-01T00:00:00Z" }).client;
    const res = await call("/sms-consent");
    expect(res.status).toBe(404);
    expect((await read(res)).error?.code).toBe("invalid_link");
  });
});

describe("agreeing", () => {
  it("takes nothing while the wording is draft", async () => {
    draft();
    const rec = seed();
    holder.client = rec.client;
    const res = await agree();
    expect(res.status).toBe(409);
    expect((await read(res)).error?.code).toBe("sms_consent_not_final");
    expect(rec.writtenRows("sms_consents")).toEqual([]);
  });

  it("refuses before the ESIGN consent, whatever the SMS wording says", async () => {
    publish();
    const rec = seed([], { consented_at: null });
    holder.client = rec.client;
    const res = await agree();
    expect(res.status).toBe(409);
    expect((await read(res)).error?.code).toBe("esign_consent_required");
    expect(rec.writtenRows("sms_consents")).toEqual([]);
  });

  it("records the number in E.164 with the served words, and sends one confirmation", async () => {
    publish();
    // 16:00 Eastern — inside the all-US civil window, so the confirmation is not held.
    vi.useFakeTimers({ now: new Date("2026-09-25T20:00:00Z"), toFake: ["Date"] });
    sms.fn.mockResolvedValue({ ok: true, provider: "telnyx", messageId: "m-1" });
    const rec = seed();
    holder.client = rec.client;
    const res = await agree();
    vi.useRealTimers();

    expect(res.status).toBe(201);
    expect((await read(res)).confirmation).toBe("sent");
    const [row] = rec.writtenRows("sms_consents");
    expect(row).toMatchObject({ org_id: ORG, driver_id: DRIVER, phone: "+17082365732", source: "application" });
    expect(String(row!.consent_text)).toContain("Silvicom Inc");
    expect(sms.fn).toHaveBeenCalledTimes(1);
    expect(sms.fn.mock.calls[0]![1].body).toContain("STOP");
  });

  it("holds the confirmation outside civil hours and says so", async () => {
    publish();
    // 03:00 Eastern.
    vi.useFakeTimers({ now: new Date("2026-09-25T07:00:00Z"), toFake: ["Date"] });
    const rec = seed();
    holder.client = rec.client;
    const res = await agree();
    vi.useRealTimers();
    expect((await read(res)).confirmation).toBe("held");
    expect(sms.fn).not.toHaveBeenCalled();
    // A-11 (C2d): held means QUEUED for the morning now, never dropped.
    expect(rec.writtenRows("sms_outbox")[0]).toMatchObject({ template: "consent_confirm", status: "queued" });
  });

  it("treats a second press on the same number as the same agreement", async () => {
    publish();
    const rec = seed([{ id: "c-1", phone: "+17082365732", driver_id: DRIVER, granted_at: "2026-09-25T10:00:00Z", revoked_at: null }]);
    holder.client = rec.client;
    const res = await agree("708-236-5732");
    expect(res.status).toBe(200);
    expect((await read(res)).confirmation).toBeNull();
    expect(rec.writtenRows("sms_consents")).toEqual([]);
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("refuses a number that is not a US mobile", async () => {
    publish();
    holder.client = seed().client;
    const res = await agree("12345678");
    expect(res.status).toBe(400);
    expect((await read(res)).error?.code).toBe("invalid_phone");
  });

  /** G-2 (C2d2): agreeing takes a dialable US number; matching an inbound STOP stays permissive. */
  it("refuses an international number", async () => {
    publish();
    const rec = seed();
    holder.client = rec.client;
    const res = await agree("+447700900123");
    expect(res.status).toBe(400);
    expect((await read(res)).error?.code).toBe("invalid_phone");
    expect(rec.writtenRows("sms_consents")).toEqual([]);
  });

  /** The page cannot undo what was said by text: START first (C2d2). */
  it("refuses a number that texted STOP until it texts START, and sends it nothing", async () => {
    publish();
    const stopped = { id: "s-1", org_id: ORG, phone: "+17082365732", reason: "stop" };
    const rec = seed([], {}, [{ ...stopped, lifted_at: null }]);
    holder.client = rec.client;
    const res = await agree();
    expect(res.status).toBe(409);
    expect((await read(res)).error?.code).toBe("number_stopped");
    expect(rec.writtenRows("sms_consents")).toEqual([]);
    expect(sms.fn).not.toHaveBeenCalled();
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);

    const started = seed([], {}, [{ ...stopped, lifted_at: "2026-09-26T10:00:00Z" }]);
    holder.client = started.client;
    expect((await agree()).status).toBe(201);
  });

  /**
   * G-2: each new number is sent a confirmation, so one link takes at most three — revoked ones
   * included, or withdrawing would reset the count. A number already agreed on the link is not a new
   * one, and a consent from before this link was created is another link's.
   */
  describe("at most three numbers per link", () => {
    const LINK_CREATED = "2026-09-20T00:00:00Z";
    const used = ["+13125550101", "+13125550102", "+13125550103"].map((phone, i) => ({
      id: `c-${i}`, driver_id: DRIVER, phone, granted_at: `2026-09-2${i + 1}T10:00:00Z`, revoked_at: "2026-09-24T10:00:00Z",
    }));

    it("refuses a fourth different number", async () => {
      publish();
      const rec = seed(used, { created_at: LINK_CREATED });
      holder.client = rec.client;
      const res = await agree();
      expect(res.status).toBe(409);
      expect((await read(res)).error?.code).toBe("too_many_numbers");
      expect(rec.writtenRows("sms_consents")).toEqual([]);
    });

    it("takes a number already agreed on the link again", async () => {
      publish();
      holder.client = seed(used, { created_at: LINK_CREATED }).client;
      expect((await agree("(312) 555-0102")).status).toBe(201);
    });

    it("does not count a consent from before the link was created", async () => {
      publish();
      holder.client = seed(used, { created_at: "2026-09-22T00:00:00Z" }).client;
      expect((await agree()).status).toBe(201);
    });
  });

  it("refuses an unticked box — the act is the whole request", async () => {
    publish();
    holder.client = seed().client;
    const res = await call("/sms-consent", { method: "POST", body: JSON.stringify({ phone: "7082365732", agreed: false }) });
    expect(res.status).toBe(400);
  });
});

describe("withdrawing", () => {
  it("revokes every live number this applicant holds, in their own org, even while draft", async () => {
    const rec = seed([{ phone: "+17082365732" }, { phone: "+13125550100" }]);
    holder.client = rec.client;
    const res = await call("/sms-consent/withdraw", { method: "POST" });
    expect(res.status).toBe(200);
    const rpcs = rec.rpcs().filter((r) => r.fn === "revoke_sms_consent");
    expect(rpcs.map((r) => (r.args as { p_phone: string }).p_phone).sort()).toEqual(["+13125550100", "+17082365732"]);
    for (const r of rpcs) expect((r.args as { p_org: string }).p_org).toBe(ORG);
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);
  });
});
