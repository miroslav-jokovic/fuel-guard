import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * The echo scan as a ROUTE, not as a module.
 *
 * `echoScan.test.ts` next door is structural — it reads the source and proves the endpoint cannot
 * write, cannot use the interactive lane, and is charged the vendor budget. Every one of those
 * passed while the endpoint was, in fact, broken twice in production:
 *
 *   1. a 403 from a production gate inherited through a reused helper, and
 *   2. a bare 500 `internal_error` because `errorResponder` only understands `HttpError`, so any
 *      `EfsSoapError` from the login or the card list fell through with no diagnosis attached.
 *
 * Neither was findable by reading the module. Both are trivially findable by calling it. This file
 * is the coverage that should have existed before #18 shipped.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ENDPOINT = "https://ws.partner.efsllc.com/axis2/services/CardManagementWS/";
/** Obviously fake: `lint:secrets` scans tracked content and a realistic PAN would trip it. */
const PAN = "70830000000000000";

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: KEY,
  EFS_CARD_CONTROL_ENABLED: "true",
  EFS_SOAP_INTERACTIVE_RPS: "100",
  EFS_SOAP_MAX_RPS: "100",
} as NodeJS.ProcessEnv);

const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");
const soap = (body: string): string =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const CREDENTIALS = {
  org_id: ORG,
  environment: "sandbox",
  endpoint_url: ENDPOINT,
  soap_username: "user",
  soap_password: "pass",
  soap_password_sealed: null,
  account_id: null,
  posted_last_cursor: null, rejected_last_cursor: null,
  posted_last_polled_at: null, rejected_last_polled_at: null,
  posted_last_success_at: null, rejected_last_success_at: null,
  posted_last_error: null, rejected_last_error: null,
  enabled: true,
};

const summariesOk = soap(
  `<getCardSummariesv2Response><return><value><cardNumber>${PAN}</cardNumber><policyNumber>14</policyNumber></value></return></getCardSummariesv2Response>`,
);

/**
 * Canned vendor responses, chosen per call by what the body asks for.
 *
 * `onSummaries` is the seam every case here turns on: the account-level list is the one step whose
 * failure ends the whole scan, so it is the one worth being able to break on demand.
 */
function stubVendor(onSummaries: () => Response): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      return realFetch(input as Parameters<typeof fetch>[0], init);
    }
    const body = String(init?.body ?? "");
    if (body.includes("CardManagementEP_login")) {
      return new Response(soap("<loginResponse><result>sess-1</result></loginResponse>"), { status: 200 });
    }
    if (body.includes("CardSummaries")) return onSummaries();
    return new Response(fixture("getCardV2.full.xml"), { status: 200 });
  }) as typeof fetch);
}

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "admin") throw new Error("bad token");
    return ADMIN;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestServer(server);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function scan(body: unknown = {}): Promise<{ status: number; payload: Record<string, unknown> }> {
  holder.client = createSupabaseRecorder({
    tables: { efs_soap_credentials: [CREDENTIALS], audit_logs: { data: [], error: null } },
  }).client;
  const res = await fetch(`${baseUrl}/api/fuel-cards/echo-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer admin" },
    body: JSON.stringify(body),
  });
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
}

describe("the echo scan, called", () => {
  it("scans the account and reports a clean card", async () => {
    stubVendor(() => new Response(summariesOk, { status: 200 }));
    const { status, payload } = await scan({ limit: 5 });

    expect(status).toBe(200);
    expect(payload).toMatchObject({ total: 1, scanned: 1, passed: 1, failed: 0, nextOffset: null });
    // Identified by last four ONLY — the response must never carry a PAN.
    expect(payload.results).toEqual([expect.objectContaining({ last4: "0000", ok: true })]);
    expect(JSON.stringify(payload)).not.toContain(PAN);
  });

  /**
   * THE regression test for the production 500.
   *
   * `errorResponder` maps only `HttpError`; everything else becomes `internal_error` with no detail.
   * So a vendor refusal on the card list — the exact thing an operator runs this endpoint to learn
   * about — arrived as an empty envelope and the run told us nothing.
   */
  it("names the vendor failure when the card list is refused, rather than answering 500", async () => {
    stubVendor(() => new Response(soap(
      "<soap:Fault><faultstring>Not authorized for this operation</faultstring></soap:Fault>",
    ), { status: 200 }));

    const { status, payload } = await scan({ limit: 5 });

    expect(status).not.toBe(500);
    expect(status).toBe(502);
    const error = payload.error as { code: string; message: string };
    expect(error.code).toMatch(/^efs_/);
    expect(error.message).toContain("Could not list this account's cards");
    // The vendor's own words survive. Without them the operator is back to guessing.
    expect(error.message).toContain("Not authorized");
  });

  it("reports an unreadable card as a failed row and keeps going", async () => {
    // A per-card failure is NOT the account-level failure above: the sweep continues and the row is
    // recorded, so one bad card cannot hide the rest or masquerade as a pass.
    stubVendor(() => new Response(soap(
      `<getCardSummariesv2Response><return>`
        + `<value><cardNumber>${PAN}</cardNumber><policyNumber>14</policyNumber></value>`
        + `<value><cardNumber>70830000000000001</cardNumber><policyNumber>14</policyNumber></value>`
        + `</return></getCardSummariesv2Response>`,
    ), { status: 200 }));

    const realFetch = globalThis.fetch;
    let cardReads = 0;
    vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("127.0.0.1")) return realFetch(input as Parameters<typeof fetch>[0], init);
      const body = String(init?.body ?? "");
      if (body.includes("CardManagementEP_login")) {
        return new Response(soap("<loginResponse><result>sess-1</result></loginResponse>"), { status: 200 });
      }
      if (body.includes("CardSummaries")) {
        return new Response(soap(
          `<getCardSummariesv2Response><return>`
            + `<value><cardNumber>${PAN}</cardNumber><policyNumber>14</policyNumber></value>`
            + `<value><cardNumber>70830000000000001</cardNumber><policyNumber>14</policyNumber></value>`
            + `</return></getCardSummariesv2Response>`,
        ), { status: 200 });
      }
      cardReads += 1;
      if (cardReads === 1) {
        return new Response(soap("<soap:Fault><faultstring>Card not found</faultstring></soap:Fault>"), { status: 200 });
      }
      return new Response(fixture("getCardV2.full.xml"), { status: 200 });
    }) as typeof fetch);

    const { status, payload } = await scan({ limit: 5 });

    expect(status).toBe(200);
    expect(payload).toMatchObject({ scanned: 2, passed: 1, failed: 1 });
    const results = payload.results as { ok: boolean; error?: string }[];
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.error).toBeTruthy();
  });

  it("refuses a caller who is not an admin", async () => {
    stubVendor(() => new Response(summariesOk, { status: 200 }));
    holder.client = createSupabaseRecorder({ tables: { efs_soap_credentials: [CREDENTIALS] } }).client;
    const res = await fetch(`${baseUrl}/api/fuel-cards/echo-scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});
