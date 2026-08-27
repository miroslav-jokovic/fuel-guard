import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";
import { __resetEfsSessions } from "../../lib/efsSoapSession.js";
import { __resetCardWriteWindows } from "../../middleware/cardWriteLimit.js";

/**
 * The odometer override as a ROUTE (`docs/37` §6 E′).
 *
 * ── What makes this endpoint worth its own suite ────────────────────────────────────────────────
 * `overrideLastMileage` returns NOTHING — its response message is declared with no parts — so every
 * claim this route makes about what happened comes from reads it performed itself. The cases below
 * are therefore mostly about EVIDENCE: that a write is followed by a re-read, that the re-read's
 * answer is what the response reports, and that a vendor which silently ignores the write is not
 * reported as success. That last one is the H1 failure this codebase has already paid for once.
 *
 * It is also the first vendor write in the product with no capability ledger behind it, so the
 * audit row is the only durable record and is asserted here rather than assumed.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VEHICLE_ID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
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

const soap = (body: string): string =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const mileageResponse = (unit: string, mileage: number | null): string =>
  soap(
    `<getLastMileageResponse><result>${
      mileage === null ? "" : `<value><unit>${unit}</unit><code>ODRD</code><mileage>${mileage}</mileage></value>`
    }</result></getLastMileageResponse>`,
  );

const CREDENTIALS = {
  org_id: ORG, environment: "sandbox", endpoint_url: ENDPOINT,
  soap_username: "user", soap_password: "pass", soap_password_sealed: null, account_id: null,
  posted_last_cursor: null, rejected_last_cursor: null,
  posted_last_polled_at: null, rejected_last_polled_at: null,
  posted_last_success_at: null, rejected_last_success_at: null,
  posted_last_error: null, rejected_last_error: null,
  enabled: true,
};

const VEHICLE = { id: VEHICLE_ID, current_odometer: 258900, odometer_offset: 0 };

/**
 * Stub the vendor with a SEQUENCE of mileage readings.
 *
 * The reads before and after the write must be able to differ — that difference is the entire
 * verification — so `readings` is consumed one `getLastMileage` at a time rather than being one
 * fixed response. A stub that answered identically both times could not tell a landed write from an
 * ignored one, which is precisely the distinction under test.
 */
function stubVendor(readings: Array<number | null>, opts: { unit?: string } = {}): { ops: string[] } {
  const realFetch = globalThis.fetch;
  const ops: string[] = [];
  const queue = [...readings];
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      return realFetch(input as Parameters<typeof fetch>[0], init);
    }
    const body = String(init?.body ?? "");
    const op = /<CardManagementEP_([A-Za-z0-9]+)>/.exec(body)?.[1] ?? "unknown";
    ops.push(op);
    if (op === "login") return new Response(soap("<loginResponse><result>sess-1</result></loginResponse>"), { status: 200 });
    if (op === "getLastMileage") {
      const next = queue.length > 1 ? queue.shift()! : queue[0] ?? null;
      return new Response(mileageResponse(opts.unit ?? "688", next), { status: 200 });
    }
    // The real thing: a response with no parts at all. Not an empty `<result>` — nothing.
    if (op === "overrideLastMileage") {
      return new Response(soap("<overrideLastMileageResponse/>"), { status: 200 });
    }
    return new Response(soap(`<${op}Response><result/></${op}Response>`), { status: 200 });
  }) as typeof fetch);
  return { ops };
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
  __resetEfsSessions();
  __resetCardWriteWindows();
});

let db: ReturnType<typeof createSupabaseRecorder>;

function recorder(vehicle: unknown = VEHICLE) {
  db = createSupabaseRecorder({
    tables: {
      efs_soap_credentials: [CREDENTIALS],
      audit_logs: { data: [], error: null },
      vehicles: { data: vehicle, error: null },
    },
    // `unit_mileage` is a fail-CLOSED bucket, so an unstubbed counter is a 503 rather than a passed
    // limit — the same symptom migration 0201 exists to prevent in production.
    rpc: { bump_card_write_counter: { allowed: true } },
  });
  holder.client = db.client;
}

/** The vehicles table answering with an ERROR rather than an empty result. */
async function postWithVehicleError(body: unknown) {
  db = createSupabaseRecorder({
    tables: {
      efs_soap_credentials: [CREDENTIALS],
      audit_logs: { data: [], error: null },
      vehicles: { data: null, error: { message: "connection reset" } },
    },
    rpc: { bump_card_write_counter: { allowed: true } },
  });
  holder.client = db.client;
  const res = await fetch(`${baseUrl}/api/fuel-cards/unit-mileage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
}

async function post(body: unknown, vehicle: unknown = VEHICLE) {
  recorder(vehicle);
  const res = await fetch(`${baseUrl}/api/fuel-cards/unit-mileage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
}

async function get(query: string, vehicle: unknown = VEHICLE) {
  recorder(vehicle);
  const res = await fetch(`${baseUrl}/api/fuel-cards/unit-mileage?${query}`, {
    headers: { Authorization: "Bearer token" },
  });
  return { status: res.status, payload: (await res.json()) as Record<string, unknown> };
}

describe("correcting the mileage EFS holds", () => {
  it("reads, writes, and RE-READS — and reports the re-read", async () => {
    const vendor = stubVendor([258536, 258900]);
    const { status, payload } = await post({ unit: "688", mileage: 258900 });

    expect(status).toBe(200);
    // The shape the whole design rests on. The second read is not belt-and-braces: the write's
    // response carries nothing, so without it there is no evidence at all.
    expect(vendor.ops).toEqual(["login", "getLastMileage", "overrideLastMileage", "getLastMileage"]);
    expect(payload.landing).toBe("landed");
    expect(payload.before).toBe(258536);
    expect(payload.after).toBe(258900);
    expect(payload.ok).toBe(true);
  });

  it("does NOT report success when the vendor accepted the write and ignored it", async () => {
    /**
     * H1, on this operation. EFS answering 200 to a write it silently dropped is documented
     * behaviour for shapes it does not recognise, and here there is no result element to hint at
     * it — the reading simply does not move. Reporting that as success is the failure mode this
     * route exists to make impossible.
     */
    const vendor = stubVendor([258536, 258536]);
    const { status, payload } = await post({ unit: "688", mileage: 258900 });

    expect(status).toBe(200);
    expect(vendor.ops).toContain("overrideLastMileage");
    expect(payload.landing).toBe("not_landed");
    expect(payload.ok).toBe(false);
    // 200, not 502: the request was well-formed, authorised, dispatched and verified. What failed
    // was the vendor's action, and the caller needs `before`/`after` to see that — a thrown error
    // would lose exactly the two numbers that are the evidence.
    expect(payload.before).toBe(258536);
    expect(payload.after).toBe(258536);
  });

  it("calls the reading indeterminate when something else wrote after us", async () => {
    stubVendor([258536, 260000]);
    // EFS's reading has its own writer — the ELD feed whose drift is the reason for this feature —
    // and it can move between our write and our re-read. Neither the old value nor ours is not
    // failure, and calling it `not_landed` would send an operator to repeat a write that worked.
    const { payload } = await post({ unit: "688", mileage: 258900 });
    expect(payload.landing).toBe("indeterminate");
  });

  it("skips the dispatch when EFS already holds the requested reading", async () => {
    /**
     * OEG-3's reasoning applied to production. The re-read after a write would show the requested
     * value whether or not the vendor did anything, so this is the one case where reporting
     * `landed` would be unfounded — and it is reported as its own outcome rather than as success.
     */
    const vendor = stubVendor([258536]);
    const { payload } = await post({ unit: "688", mileage: 258536 });

    expect(vendor.ops).not.toContain("overrideLastMileage");
    expect(payload.landing).toBe("already_current");
    expect(payload.dispatched).toBe(false);
    // The operator's intent IS satisfied, so this is not a failure.
    expect(payload.ok).toBe(true);
  });

  it("refuses a unit that is not a truck in this company, before dialling the vendor", async () => {
    // The typo boundary, not the account boundary — the EFS session is already org-scoped. `688`
    // and `868` are both plausible units, the vendor accepts either, and the operation returns
    // nothing that would say the reading landed on the wrong truck.
    const vendor = stubVendor([258536]);
    const { status, payload } = await post({ unit: "868", mileage: 258900 }, null);

    expect(status).toBe(404);
    expect((payload.error as { code: string }).code).toBe("unknown_unit");
    expect(vendor.ops).toEqual([]);
  });

  it("rejects a mileage far past any real odometer", async () => {
    // `xsd:int` would take 2.1 billion happily and leave a baseline no truck can reach — every
    // later pump entry outside the accrual window, and the truck unable to fuel until somebody
    // finds this screen again.
    const vendor = stubVendor([258536]);
    const { status, payload } = await post({ unit: "688", mileage: 999_000_000 });

    expect(status).toBe(400);
    expect((payload.error as { code: string }).code).toBe("invalid_request");
    expect(vendor.ops).toEqual([]);
  });

  it("refuses the vendor's own display label as a code", async () => {
    // The portal renders `Code` as "odometer"; the wire value is ODRD. Sending the label would be
    // dispatched into an operation that returns nothing to say it was wrong (`docs/37` §3a).
    const { status } = await post({ unit: "688", code: "odometer", mileage: 258900 });
    expect(status).toBe(400);
  });

  it("is admin-only", async () => {
    auth = FLEET_MANAGER;
    const vendor = stubVendor([258536]);
    const { status } = await post({ unit: "688", mileage: 258900 });
    expect(status).toBe(403);
    expect(vendor.ops).toEqual([]);
  });

  it("audits every outcome, carrying both readings and the verdict", async () => {
    /**
     * There is no ledger row behind this write, so this is the only durable record it leaves. The
     * rows somebody will need most are the ones that did NOT land, which is why the audit is
     * written on every outcome rather than on success.
     */
    stubVendor([258536, 258536]);
    await post({ unit: "688", mileage: 258900 });

    const audit = db.writtenRows("audit_logs").at(-1) as unknown as
      { action: string; entity_id: string; meta: Record<string, unknown> };
    expect(audit.action).toBe("efs.unit_mileage_overridden");
    // The VEHICLE's uuid: `audit_logs.entity_id` is a uuid column, and a unit string there is moved
    // into meta with a stderr line, losing the field that makes the row findable.
    expect(audit.entity_id).toBe(VEHICLE_ID);
    expect(audit.meta).toMatchObject({ unit: "688", requested: 258900, before: 258536, after: 258536, landing: "not_landed" });
  });
});

describe("showing EFS's reading beside ours", () => {
  it("returns both, the offset, and the drift between them", async () => {
    stubVendor([258536]);
    const { payload } = await get("unit=688");
    expect(payload.efsMileage).toBe(258536);
    expect(payload.knownVehicle).toBe(true);
    expect(payload.ourMileage).toBe(258900);
    // 258900 − 258536. The number that tells an operator whether a correction is even warranted.
    expect(payload.drift).toBe(364);
  });

  it("reports no drift rather than a zero when EFS holds no reading for the unit", async () => {
    stubVendor([null]);
    const { payload } = await get("unit=688");
    expect(payload.efsMileage).toBeNull();
    // Zero would read as "they agree", which is the opposite of what an absent reading means.
    expect(payload.drift).toBeNull();
  });

  it("still asks EFS about a unit our fleet does not model, and says so", async () => {
    /**
     * The READ deliberately does not 404 where the WRITE does.
     *
     * Refusing here would hide the most interesting thing this endpoint can find — EFS holding a
     * reading for a truck we do not model — behind a 404 that reads as "no such truck", when the
     * truth is "no such truck HERE, and the vendor disagrees".
     */
    const vendor = stubVendor([258536]);
    const { status, payload } = await get("unit=688", null);

    expect(status).toBe(200);
    expect(vendor.ops).toContain("getLastMileage");
    expect(payload.efsMileage).toBe(258536);
    expect(payload.knownVehicle).toBe(false);
    // No vehicle means no comparison — reported as absent, never as agreement.
    expect(payload.ourMileage).toBeNull();
    expect(payload.drift).toBeNull();
  });

  it("does not claim the truck is absent when the lookup itself failed", async () => {
    /**
     * "No vehicle has unit 991" is a factual claim about the fleet. On a database error we have not
     * checked it, and saying so anyway sends somebody to add a truck that may already be there.
     */
    const vendor = stubVendor([258536]);
    const { status, payload } = await postWithVehicleError({ unit: "991", mileage: 258900 });

    expect(status).toBe(503);
    expect((payload.error as { code: string }).code).toBe("vehicle_lookup_failed");
    expect((payload.error as { message: string }).message).not.toContain("No vehicle");
    expect(vendor.ops).toEqual([]);
  });

  it("says WHERE the unit was checked, so an EFS unit number is not mistaken for ours", async () => {
    // The QA confusion of 2026-08-17 exactly: a UNIT prompt set on an EFS card does not create a
    // vehicle here, and the refusal never said which list it had consulted.
    const { payload } = await post({ unit: "991", mileage: 258900 }, null);
    const message = (payload.error as { message: string }).message;
    expect(message).toContain("Silvicom 360's own");
    expect(message).toContain("not against EFS");
  });

  it("still refuses an unknown unit on the WRITE — the two halves differ on purpose", async () => {
    const vendor = stubVendor([258536]);
    const { status } = await post({ unit: "868", mileage: 258900 }, null);
    expect(status).toBe(404);
    expect(vendor.ops).toEqual([]);
  });
});
