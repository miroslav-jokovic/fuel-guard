import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SMS_CONSENT } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { TEXT_LINK_LIMIT } from "../../../middleware/applicationLimits.js";
import { hashInvitationToken } from "../applicationIntake.js";

/**
 * "Text me the link" (§6.6.6, C3b2b2), end to end.
 *
 * What is pinned: the text carries THIS request's own link and nothing the client sent; every gate of
 * `sendApplicationSms` answers `held` with its reason (quiet hours, no consent, a stopped number) and
 * nothing is queued, because a link-bearing text is send-now-or-never (Q-AW29); the ESIGN consent comes
 * first; a dead link is the one `invalid_link`; and one link cannot text the phone more than three
 * times in ten minutes.
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
const WEB = "https://360.example.test";
/** 16:00 Eastern — inside the all-US civil window. */
const AFTERNOON = new Date("2026-09-25T20:00:00Z");
/** 03:00 Eastern. */
const NIGHT = new Date("2026-09-25T07:00:00Z");

let server: Server;
let baseUrl: string;
let seq = 0;
/**
 * A fresh link per test: the limiter under test is keyed by the link and lives as long as the app, so
 * one shared token would have every test after the third refused for a reason none of them is about.
 */
let n = 0;
const freshToken = (): string => String(++n).padStart(3, "0").repeat(15).slice(0, 43);

const textLink = (token: string, body: unknown = {}) =>
  fetch(`${baseUrl}/api/public/application/${token}/text-link`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(seq++ % 250) + 1}` },
  });

const publish = () => vi.spyOn(SMS_CONSENT, "version", "get").mockReturnValue("v1");

type Row = Record<string, unknown>;
const LIVE = { id: "c-1", phone: "+17082365732", granted_at: "2026-09-25T10:00:00Z", revoked_at: null };

const seed = (token: string, consents: Row[] = [LIVE], invitation: Row = {}, suppressions: Row[] = []) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [{
        id: "inv-1", org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(token),
        expires_at: "2099-01-01T00:00:00Z", revoked_at: null, consented_at: "2026-09-14T08:00:00Z",
        ...invitation,
      }],
      organizations: [{ name: "Silvicom Inc" }],
      sms_consents: postgrestFixture(consents.map((r) => ({ org_id: ORG, driver_id: DRIVER, ...r }))),
      sms_suppressions: postgrestFixture(suppressions),
      sms_outbox: [],
    },
  });
const TOKEN_LOOKUP = { exempt: ["application_invitations", "organizations"] };
const read = async (res: Response) => (await res.json()) as { outcome?: string; held?: string; error?: { code: string } };

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test", WEB_APP_URL: WEB } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sms.fn.mockReset();
});

describe("POST /:token/text-link", () => {
  it("texts this link — composed from the request's own token — to the number the applicant agreed on", async () => {
    publish();
    vi.useFakeTimers({ now: AFTERNOON, toFake: ["Date"] });
    sms.fn.mockResolvedValue({ ok: true, provider: "telnyx", messageId: "m-1" });
    const token = freshToken();
    const rec = seed(token);
    holder.client = rec.client;
    // A body the client made up is ignored: the server texts only what it composed.
    const res = await textLink(token, { link: "https://evil.test/", phone: "+13125550100" });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ outcome: "sent" });
    expect(sms.fn).toHaveBeenCalledTimes(1);
    const sent = sms.fn.mock.calls[0]![1] as { to: string; body: string };
    expect(sent.to).toBe("+17082365732");
    expect(sent.body).toContain(`${WEB}/apply/${token}`);
    expect(sent.body).not.toContain("evil.test");
    expect(sent.body.startsWith("Silvicom Inc")).toBe(true);
    // Send-now-or-never (Q-AW29): the link never sits in the outbox, and nothing rotates the token.
    expect(rec.writtenRows("sms_outbox")).toEqual([]);
    expect(rec.writtenRows("application_invitations")).toEqual([]);
    expectOrgScoped(rec, ORG, TOKEN_LOOKUP);
  });

  it("holds it outside civil hours, says so, and queues nothing", async () => {
    publish();
    vi.useFakeTimers({ now: NIGHT, toFake: ["Date"] });
    const token = freshToken();
    const rec = seed(token);
    holder.client = rec.client;
    expect(await read(await textLink(token))).toEqual({ outcome: "held", held: "quiet_hours" });
    expect(sms.fn).not.toHaveBeenCalled();
    expect(rec.writtenRows("sms_outbox")).toEqual([]);
  });

  it("holds it without a live consent", async () => {
    publish();
    vi.useFakeTimers({ now: AFTERNOON, toFake: ["Date"] });
    const token = freshToken();
    holder.client = seed(token, [{ ...LIVE, revoked_at: "2026-09-25T11:00:00Z" }]).client;
    expect(await read(await textLink(token))).toEqual({ outcome: "held", held: "no_consent" });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("holds it for a number that replied STOP", async () => {
    publish();
    vi.useFakeTimers({ now: AFTERNOON, toFake: ["Date"] });
    const token = freshToken();
    holder.client = seed(token, [LIVE], {}, [
      { org_id: ORG, phone: "+17082365732", reason: "stop", lifted_at: null },
    ]).client;
    expect(await read(await textLink(token))).toEqual({ outcome: "held", held: "suppressed" });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("holds it while the consent wording is a draft", async () => {
    vi.spyOn(SMS_CONSENT, "version", "get").mockReturnValue("v0-draft");
    vi.useFakeTimers({ now: AFTERNOON, toFake: ["Date"] });
    const token = freshToken();
    holder.client = seed(token).client;
    expect(await read(await textLink(token))).toEqual({ outcome: "held", held: "no_consent" });
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it("answers a failed provider in words, pointing at the QR code", async () => {
    publish();
    vi.useFakeTimers({ now: AFTERNOON, toFake: ["Date"] });
    sms.fn.mockResolvedValue({ ok: false, provider: "telnyx", detail: "boom" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const token = freshToken();
    holder.client = seed(token).client;
    const res = await textLink(token);
    expect(res.status).toBe(502);
    expect((await read(res)).error?.code).toBe("sms_failed");
  });

  it("refuses before the ESIGN consent, and a dead link is the one invalid_link", async () => {
    publish();
    const token = freshToken();
    holder.client = seed(token, [LIVE], { consented_at: null }).client;
    const early = await textLink(token);
    expect(early.status).toBe(409);
    expect((await read(early)).error?.code).toBe("esign_consent_required");

    const dead = freshToken();
    holder.client = seed(dead, [LIVE], { revoked_at: "2026-09-20T00:00:00Z" }).client;
    const res = await textLink(dead);
    expect(res.status).toBe(404);
    expect((await read(res)).error?.code).toBe("invalid_link");
    expect(sms.fn).not.toHaveBeenCalled();
  });

  it(`texts one link at most ${TEXT_LINK_LIMIT} times in ten minutes, and another link is its own count`, async () => {
    publish();
    vi.useFakeTimers({ now: AFTERNOON, toFake: ["Date"] });
    sms.fn.mockResolvedValue({ ok: true, provider: "telnyx", messageId: "m-1" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const token = freshToken();
    holder.client = seed(token).client;
    for (let i = 0; i < TEXT_LINK_LIMIT; i += 1) expect((await textLink(token)).status).toBe(200);
    const refused = await textLink(token);
    expect(refused.status).toBe(429);
    expect((await read(refused)).error?.code).toBe("too_many_requests");
    expect(sms.fn).toHaveBeenCalledTimes(TEXT_LINK_LIMIT);

    const other = freshToken();
    holder.client = seed(other).client;
    expect((await textLink(other)).status).toBe(200);
  });
});
