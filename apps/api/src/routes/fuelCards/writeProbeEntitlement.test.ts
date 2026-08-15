import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@fuelguard/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder } from "../../testing/supabaseRecorder.js";

/**
 * Step 2.7 — what a READ-ONLY entitlement probe is allowed to change.
 *
 * The defect these tests exist for: `/write-check` upserted `write_entitlement` from the run's own
 * verdict unconditionally, and `judge()` returns `unknown` for every read-only run BY CONSTRUCTION —
 * `denied` needs a permission refusal at step 5 or 7, `confirmed` needs step 8, and none of those run
 * when `readOnly` is true. So the harmless diagnostic silently downgraded an already-`confirmed` org
 * to `unknown` and stopped every card action in it until somebody ran the full ten-step probe against
 * a real card.
 *
 * The trap was on the CAUTIOUS route, which is what makes it worth a route-level test rather than a
 * unit test of `judge()`: `judge()` was never wrong. It reported the absence of evidence correctly.
 * The caller turned that into evidence of absence, and only a test that watches what reaches the
 * DATABASE can see the difference.
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
  EFS_CARD_CONTROL_PROBE_ENABLED: "true",
  EFS_SOAP_INTERACTIVE_RPS: "100",
  EFS_SOAP_MAX_RPS: "100",
} as NodeJS.ProcessEnv);

const ADMIN: AuthContext = { userId: "11111111-1111-4111-8111-111111111111", email: "a@x.test", orgId: ORG, role: "admin" };

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

const summaries = soap(
  `<getCardSummariesv2Response><return><value><cardNumber>${PAN}</cardNumber><policyNumber>14</policyNumber></value></return></getCardSummariesv2Response>`,
);

/** Login + card list + card read all succeed. No write is ever answered — read-only never asks. */
function stubVendor(): void {
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
    if (body.includes("CardSummaries")) return new Response(summaries, { status: 200 });
    return new Response(fixture("getCardV2.full.xml"), { status: 200 });
  }) as typeof fetch);
}

let server: Server;
let baseUrl = "";
let stepUpToken = "";

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> => {
    if (token !== "admin") throw new Error("bad token");
    return ADMIN;
  };
  // `/write-check` carries requireFreshAuth, which wants a step-up token rather than a fresh `iat`
  // (audit P0-4). Minted through the app's own issuer so the guard stays real in this test.
  const { mintStepUpToken } = await import("../../lib/stepUpToken.js");
  stepUpToken = mintStepUpToken(env, ADMIN.userId, ORG)!.token;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Run the probe against an org whose stored entitlement is `stored`, and report what was WRITTEN. */
async function probe(stored: "unknown" | "confirmed" | "denied", body: Record<string, unknown>) {
  const rec = createSupabaseRecorder({
    tables: {
      efs_soap_credentials: [CREDENTIALS],
      efs_cards: [{ id: "card-1", org_id: ORG }],
      efs_card_control_settings: { data: { write_entitlement: stored }, error: null },
      audit_logs: { data: [], error: null },
    },
  });
  holder.client = rec.client;
  const res = await fetch(`${baseUrl}/api/fuel-cards/write-check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer admin",
      "x-step-up-token": stepUpToken,
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as Record<string, unknown>;
  const written = rec.writtenRows("efs_card_control_settings");
  return { status: res.status, payload, written };
}

describe("a READ-ONLY write-check", () => {
  it("does NOT downgrade an org that already proved write access", async () => {
    stubVendor();
    const { status, payload, written } = await probe("confirmed", { cardNumber: PAN, confirm: "", readOnly: true });

    expect(status).toBe(200);
    // THE assertion. Before Step 2.7 this row carried `write_entitlement: "unknown"`, and that one
    // key stopped every card action in the org.
    expect(written).toHaveLength(1);
    expect(written[0]).not.toHaveProperty("write_entitlement");
    // And the response must not tell the operator they lost it either.
    expect(payload.entitlement).toBe("confirmed");
    expect(payload.entitlementWritten).toBe(false);
    // What the run itself could conclude is still reported, honestly and separately.
    expect(payload.judgedEntitlement).toBe("unknown");
  });

  it("still records the credential identity binding, which needs no write", async () => {
    stubVendor();
    const { written } = await probe("confirmed", { cardNumber: PAN, confirm: "", readOnly: true });

    // Step 2.6's binding is observed on every run. A read-only probe is now the cheap way to rebind
    // a credential without touching a card — which is the opposite of what it used to cost.
    expect(written[0]).toMatchObject({
      probed_identity_hash: expect.any(String),
      probed_endpoint_host: "ws.partner.efsllc.com",
    });
  });

  it("tells a confirmed org it changed nothing, instead of sending it to write to a real card", async () => {
    stubVendor();
    const { payload } = await probe("confirmed", { cardNumber: PAN, confirm: "", readOnly: true });

    expect(payload.recommendation).toBe("no_action");
    expect(String(payload.verdict)).toContain("changed nothing");
    // The old text sent every read-only run here, including orgs with nothing left to prove.
    expect(String(payload.verdict)).not.toContain("still UNPROVEN");
  });

  it("leaves an unproven org unproven, and still points it at the write half", async () => {
    stubVendor();
    const { payload, written } = await probe("unknown", { cardNumber: PAN, confirm: "", readOnly: true });

    // The pair matters: a fix that simply never wrote the column would satisfy the first test for the
    // wrong reason. An org with nothing to lose must still be told what to do next.
    expect(written[0]).not.toHaveProperty("write_entitlement");
    expect(payload.entitlement).toBe("unknown");
    expect(payload.recommendation).toBe("run_write_half");
    expect(String(payload.verdict)).toContain("UNPROVEN");
  });

  it("does not resurrect a DENIED org either", async () => {
    stubVendor();
    const { payload, written } = await probe("denied", { cardNumber: PAN, confirm: "", readOnly: true });

    // `denied` means EFS refused our writes. A read-only run has no standing to soften that to
    // `unknown` any more than it has standing to lower `confirmed` — the column is not this run's
    // to touch in either direction.
    expect(written[0]).not.toHaveProperty("write_entitlement");
    expect(payload.entitlement).toBe("denied");
  });

  it("does not erase a recorded document shape when the card read fails", async () => {
    // Login succeeds, the card list succeeds, the card READ fails — so no shape is observed. Writing
    // null here would overwrite a shape an earlier probe established, which is the same defect as the
    // entitlement one column over: absence of an observation is not an observation of absence.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("127.0.0.1")) return realFetch(input as Parameters<typeof fetch>[0], init);
      const body = String(init?.body ?? "");
      if (body.includes("CardManagementEP_login")) {
        return new Response(soap("<loginResponse><result>sess-1</result></loginResponse>"), { status: 200 });
      }
      if (body.includes("CardSummaries")) return new Response(summaries, { status: 200 });
      return new Response(soap("<soap:Fault><faultstring>boom</faultstring></soap:Fault>"), { status: 200 });
    }) as typeof fetch);

    const { written } = await probe("confirmed", { cardNumber: PAN, confirm: "", readOnly: true });

    expect(written[0]).not.toHaveProperty("probed_document_shape");
  });
});

describe("a FULL write-check", () => {
  it("still writes the entitlement it earned", async () => {
    // The guard must not have been implemented as "never write the column". A full run is the only
    // thing that may set it, and it must still do so.
    stubVendor();
    const { written, payload } = await probe("unknown", {
      cardNumber: PAN,
      confirm: `WRITE ${PAN.slice(-4)}`,
      readOnly: false,
    });

    expect(written[0]).toHaveProperty("write_entitlement");
    expect(payload.entitlementWritten).toBe(true);
    // This vendor stub answers no write, so the run cannot reach `confirmed` — the point here is
    // only that the column IS written on a full run, whatever the verdict turns out to be.
    expect(payload.judgedEntitlement).toBe(payload.entitlement);
    // Generous timeout on purpose: a full run reaches steps 7–10, which include the deliberate
    // EFS_CARD_VERIFY_RETRY_MS second look. That pause is the behaviour under test elsewhere, so it
    // is waited out here rather than stubbed away.
  }, 30_000);
});
