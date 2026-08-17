import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@fuelguard/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";
import { __resetEfsSessions } from "../../lib/efsSoapSession.js";
import { INVENTORY_REQUEST_BUDGET } from "./inventory.js";

/**
 * The account inventory as a ROUTE (execution plan Step 7.2).
 *
 * Its Verify is *"route test under 28 requests"*, and that number is the whole design constraint:
 * this endpoint walks a rate-paced shared vendor account, and the two loops inside it are unbounded
 * in the plan's written sequence. So the budget is asserted by COUNTING the requests the route
 * actually made — never by reading the caps and doing the arithmetic, which is the version that
 * stays green while the code drifts past it.
 *
 * ── What this cannot prove ──────────────────────────────────────────────────────────────────────
 * The vendor is stubbed from the WSDL-derived fixtures Step 7.1 wrote, so this proves the ROUTE:
 * sequence, budget, gating, truncation reporting and PAN discipline. It does not prove the parse
 * against production — that is what "Deployed: green on QA and on production" asks for, and it is
 * still owed.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "11111111-2222-4333-8444-555555555555";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ENDPOINT = "https://ws.partner.efsllc.com/axis2/services/CardManagementWS/";

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: KEY,
  EFS_CARD_CONTROL_ENABLED: "true",
  EFS_SOAP_INTERACTIVE_RPS: "100",
  EFS_SOAP_MAX_RPS: "100",
} as NodeJS.ProcessEnv);

const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };
const FLEET_MANAGER: AuthContext = { userId: "u-mgr", email: "m@x.test", orgId: ORG, role: "fleet_manager" };

const account = (op: string): string =>
  readFileSync(fileURLToPath(new URL(`../../lib/__fixtures__/efs/account/${op}.xml`, import.meta.url)), "utf8");
const cardFixture = readFileSync(
  fileURLToPath(new URL("../../lib/__fixtures__/efs/getCardV2.full.xml", import.meta.url)), "utf8",
);
const soap = (body: string): string =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const CREDENTIALS = {
  org_id: ORG, environment: "sandbox", endpoint_url: ENDPOINT,
  soap_username: "user", soap_password: "pass", soap_password_sealed: null, account_id: null,
  posted_last_cursor: null, rejected_last_cursor: null,
  posted_last_polled_at: null, rejected_last_polled_at: null,
  posted_last_success_at: null, rejected_last_success_at: null,
  posted_last_error: null, rejected_last_error: null,
  enabled: true,
};

/** A policy response, so the per-policy `getPolicy` leg has something to parse. */
const policyOk = soap("<getPolicyResponse><result><description>OVER THE ROAD</description></result></getPolicyResponse>");

/**
 * Stub the vendor, and COUNT every request.
 *
 * `extra` lets one case return a longer contract/policy list than the fixtures carry, which is how
 * the budget is tested against an account big enough to blow it rather than against the small one
 * the fixtures describe. A budget test on a one-policy account proves nothing.
 */
function stubVendor(extra: { contracts?: number; policies?: number } = {}): { count: () => number; ops: string[] } {
  const realFetch = globalThis.fetch;
  const ops: string[] = [];
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      return realFetch(input as Parameters<typeof fetch>[0], init);
    }
    const body = String(init?.body ?? "");
    const op = /<CardManagementEP_([A-Za-z0-9]+)>/.exec(body)?.[1] ?? "unknown";
    ops.push(op);
    if (op === "login") return new Response(soap("<loginResponse><result>sess-1</result></loginResponse>"), { status: 200 });
    if (op === "getPolicy") return new Response(policyOk, { status: 200 });
    if (op === "getCardv2") return new Response(cardFixture, { status: 200 });

    if (op === "getContracts" && extra.contracts) {
      const rows = Array.from({ length: extra.contracts }, (_, i) =>
        `<value><contractId>${5500 + i}</contractId><description>C${i}</description><status>A</status></value>`).join("");
      return new Response(soap(`<getContractsResponse><result>${rows}</result></getContractsResponse>`), { status: 200 });
    }
    if (op === "getPolicyDescriptions" && extra.policies) {
      const rows = Array.from({ length: extra.policies }, (_, i) =>
        `<value><contractId>5501</contractId><description>P${i}</description><policyNumber>${i + 1}</policyNumber></value>`).join("");
      return new Response(soap(`<getPolicyDescriptionsResponse><result>${rows}</result></getPolicyDescriptionsResponse>`), { status: 200 });
    }
    try {
      return new Response(account(op), { status: 200 });
    } catch {
      return new Response(soap(`<${op}Response><result/></${op}Response>`), { status: 200 });
    }
  }) as typeof fetch);
  return { count: () => ops.length, ops };
}

let server: Server;
let baseUrl = "";
let auth: AuthContext = ADMIN;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "token") throw new Error("bad token");
    return auth;
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
  auth = ADMIN;
  // Sessions are cached per endpoint, so without this a later case inherits an earlier
  // case's login and its request count is one lower than a cold walk's — which is exactly
  // how the budget assertion first disagreed with itself.
  __resetEfsSessions();
});

/** The recorder behind the most recent `inventory()` call, for asserting what the route WROTE. */
let db: ReturnType<typeof createSupabaseRecorder>;

async function inventory(
  body: unknown = {},
  tables: Record<string, unknown> = {},
): Promise<{ status: number; payload: Record<string, unknown> }> {
  db = createSupabaseRecorder({
    tables: {
      efs_soap_credentials: [CREDENTIALS],
      audit_logs: { data: [], error: null },
      // `loadCardNumber` reads this; the sealed value is produced by the same secretBox the route uses.
      efs_cards: { data: { card_number_sealed: null }, error: null },
      ...tables,
    },
  });
  holder.client = db.client;
  const res = await fetch(`${baseUrl}/api/fuel-cards/account-inventory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
}

describe("the account inventory, called", () => {
  it("walks the account and reports every step", async () => {
    const vendor = stubVendor();
    const { status, payload } = await inventory();

    expect(status).toBe(200);
    expect(payload.ok).toBe(true);
    // The sequence Step 7.2 specifies, in order, plus the login and getSitePolicyDescriptions.
    expect(vendor.ops).toEqual([
      "login",
      "getCarrierInfo",
      // `docs/37` §6 A, second because it gates every odometer question the way `getCarrierInfo`
      // gates every location-group one.
      "doesCardPosition",
      "getPromptTypes",
      "getContracts",
      "getCreditLimits",
      "getPolicyDescriptions",
      "getPolicy", "getPolicyRefreshingLimits",
      "getPolicy", "getPolicyRefreshingLimits",
      "getProductGroups",
      "getProducts",
      "getLocationGroupDescriptions",
      "getSitePolicyDescriptions",
      "serverTime",
    ]);
    const inv = payload.inventory as Record<string, unknown>;
    expect(inv.promptTypes).toEqual(["DRID", "UNIT", "ODOM", "NAME", "TRIP"]);
    expect(inv.serverTime).toBe("2026-08-16T09:41:07.000-05:00");
    expect((inv.carrierInfo as { locationGroups: boolean }).locationGroups).toBe(true);
    // Read out of its own part name, not `result` — the trap that would report this account, which
    // does use SecureFuel, as an account that does not.
    expect(inv.securefuel).toBe(true);
  });

  it("STAYS UNDER 29 REQUESTS on an account big enough to blow the budget", async () => {
    /**
     * The Verify, asserted by counting rather than by arithmetic.
     *
     * Twelve contracts and twelve policies would be 1 + 12 + 24 + 8 = 45 requests unbounded — well
     * past the budget. The caps hold it, and `truncated` says what was left out. A test that only
     * ever ran the two-policy fixture would pass forever without touching this.
     */
    const vendor = stubVendor({ contracts: 12, policies: 12 });
    const { status, payload } = await inventory();

    expect(status).toBe(200);
    expect(vendor.count()).toBeLessThanOrEqual(INVENTORY_REQUEST_BUDGET);
    // Every operation the route reports is one the stub actually saw, plus the login.
    expect(payload.operations).toBe(vendor.count() - 1);
    // And it really did hit the caps — otherwise the assertion above passes for the wrong reason.
    expect(payload.truncated).toEqual([
      { what: "contracts", seen: 12, walked: 4 },
      { what: "policies", seen: 12, walked: 7 },
    ]);
  });

  it("reports NOTHING as truncated when the whole account fit", async () => {
    // The positive control for the case above. `truncated` must be empty on a small account, or it
    // is noise that operators learn to ignore exactly when it starts mattering.
    const vendor = stubVendor();
    const { payload } = await inventory();
    expect(payload.truncated).toEqual([]);
    expect(vendor.count()).toBeLessThanOrEqual(INVENTORY_REQUEST_BUDGET);
  });

  it("carries on past a refused operation instead of failing whole", async () => {
    /**
     * "Which of these does this account refuse" is the question the endpoint exists to answer, and a
     * walk that aborted on the first refusal could never answer it. `ok` goes false, the step records
     * its code, and the other twelve still run.
     */
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("127.0.0.1")) return realFetch(input as Parameters<typeof fetch>[0], init);
      const body = String(init?.body ?? "");
      const op = /<CardManagementEP_([A-Za-z0-9]+)>/.exec(body)?.[1] ?? "unknown";
      if (op === "login") return new Response(soap("<loginResponse><result>sess-1</result></loginResponse>"), { status: 200 });
      if (op === "getProducts") return new Response(soap("<soap:Fault><faultstring>Not Allowed 55912</faultstring></soap:Fault>"), { status: 500 });
      if (op === "getPolicy") return new Response(policyOk, { status: 200 });
      try { return new Response(account(op), { status: 200 }); }
      catch { return new Response(soap(`<${op}Response><result/></${op}Response>`), { status: 200 }); }
    }) as typeof fetch);

    const { status, payload } = await inventory();

    expect(status).toBe(200); // the REQUEST succeeded; the vendor refused one operation
    expect(payload.ok).toBe(false);
    const steps = payload.steps as { operation: string; ok: boolean }[];
    expect(steps.find((s) => s.operation === "getProducts")?.ok).toBe(false);
    // Everything after the refusal still ran — that is the whole point.
    expect(steps.find((s) => s.operation === "serverTime")?.ok).toBe(true);
  });

  it("is admin-only — a manager who can lock a card cannot walk the account", async () => {
    // Same gate as /diagnose: it dials a shared paced account two dozen times and the answer is an
    // operations fact, not something a fleet manager acts on.
    stubVendor();
    auth = FLEET_MANAGER;
    const { status } = await inventory();
    expect(status).toBe(403);
  });

  it("takes card UUIDs, never card numbers", async () => {
    // Standing rule 13. A PAN in a request body reaches access logs and browser history; the card
    // number is resolved server-side through the org-scoped loadCardNumber instead.
    stubVendor();
    const { status, payload } = await inventory({ sampleCards: ["70830000000000000"] });
    expect(status).toBe(400);
    expect((payload.error as { code: string }).code).toBe("invalid_request");
  });

  it("refuses more sample cards than it will pay for", async () => {
    stubVendor();
    const tooMany = Array.from({ length: 26 }, (_, i) => `11111111-2222-4333-8444-${String(i).padStart(12, "0")}`);
    const { status } = await inventory({ sampleCards: tooMany });
    expect(status).toBe(400);
  });

  it("says EFS is not connected rather than walking an account it cannot reach", async () => {
    stubVendor();
    holder.client = createSupabaseRecorder({ tables: { efs_soap_credentials: [] } }).client;
    const res = await fetch(`${baseUrl}/api/fuel-cards/account-inventory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
      body: "{}",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("efs_not_configured");
  });

  it("skips a sample card whose number cannot be unsealed, rather than failing the walk", async () => {
    // `loadCardNumber` returns null for a card that is not this org's, or whose ciphertext cannot be
    // opened. A walk that threw there would lose the entire account inventory over one bad card.
    const vendor = stubVendor();
    const { status, payload } = await inventory({ sampleCards: [CARD_ID] });
    expect(status).toBe(200);
    expect((payload.inventory as { sampledCards: unknown[] }).sampledCards).toEqual([]);
    expect(vendor.ops).not.toContain("getCardv2");
  });
});

/**
 * Step 9.1. This walk is the only caller of `getPromptTypes`, so it is the only place the account's
 * prompt vocabulary can be captured — and before this it handed that vocabulary to one operator's
 * screen and dropped it. The write path reads the cached row rather than calling the vendor, because
 * the rate limiter is keyed on IP rather than on the account (Step 5.6).
 */
describe("the prompt-type cache the walk fills", () => {
  const cacheWrites = () =>
    db.queries.filter((q) => q.table === "efs_card_control_settings" && q.write !== null);

  it("writes the account's vocabulary, verbatim and dated", async () => {
    stubVendor();
    const { payload } = await inventory();

    expect(payload.promptTypesCached).toEqual({ ok: true });

    const [write] = cacheWrites();
    expect(write?.write?.method).toBe("upsert");
    const row = write?.write?.payload as { org_id: string; prompt_types: string[]; prompt_types_at: string };
    expect(row.org_id).toBe(ORG);
    // VERBATIM: the account's whole vocabulary, not the subset this product may edit. Narrowing here
    // would bake today's denial list into stored data, and re-admitting PPIN later would then need a
    // backfill rather than a code change.
    expect(row.prompt_types).toEqual((payload.inventory as { promptTypes: string[] }).promptTypes);
    expect(Number.isNaN(Date.parse(row.prompt_types_at))).toBe(false);
  });

  it("reports a failed cache write WITHOUT failing a walk whose every vendor call landed", async () => {
    stubVendor();
    const { status, payload } = await inventory(
      {},
      { efs_card_control_settings: { data: [], error: null, writeError: { message: "permission denied" } } },
    );

    // Both halves matter. The walk succeeded — every vendor read landed, and the operator has the
    // inventory in front of them — so `ok` must stay true and `operations` must not count a database
    // write. But the failure cannot be silent either: a cache that quietly did not write leaves the
    // editable set on the 2-id fallback with nothing on screen to say why.
    expect(status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.promptTypesCached).toEqual({ ok: false, error: "permission denied" });
    expect((payload.steps as unknown[]).length).toBe(payload.operations);
    expect((payload.steps as { operation: string }[]).map((s) => s.operation))
      .not.toContain("cachePromptTypes");
  });
});
