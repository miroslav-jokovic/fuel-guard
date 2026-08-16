import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AuthContext } from "@fuelguard/shared";
import { defineContract } from "@fuelguard/shared";
import { setAppLocals } from "../lib/appLocals.js";
import { loadEnv } from "../env.js";
import { seal, secretAad } from "../lib/secretBox.js";
import { credentialIdentityHash } from "../services/efsSoapCredentialIdentity.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../testing/supabaseRecorder.js";
import { promotedCapabilitiesTable } from "../testing/promotionFixture.js";
import { cardEchoVerify } from "./cardEchoVerify.js";
import { defineBehaviour } from "./types.js";
import { mount } from "./registry.js";
import { fuelCardCapabilityRouter } from "./router.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * Step 3.5b: a body-only refusal must not spend a rate-limit slot.
 *
 * ── Why this is asserted on the COUNTER and not on the call order ────────────────────────────────
 * The property is "the operator's daily budget is untouched", and the only honest witness to that is
 * `bump_card_write_counter` — the RPC `enforceCardWriteLimit` calls to charge a slot. A test that
 * read this repo's source to check `preflightStepUp` appears above `prepare()` would pass on a
 * refactor that moved the call and broke the effect, which is the failure mode `docs/29` §3 records
 * from the echo-scan endpoint: structural tests green, endpoint broken in production, twice.
 *
 * `card_lock` deliberately has no `preflightStepUp` — a lock is the 2am safety action and must stay
 * frictionless — so the capability under test is defined here. The first real one is
 * `override_grant` in Step 3.6, whose gate is "more than three uses needs a fresh sign-in".
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
/** Obviously fake: `lint:secrets` scans tracked content and a realistic PAN would trip it. */
const PAN = "70830000000000000";
const KEY = Buffer.alloc(32, 7).toString("base64");
const ENDPOINT = "https://ws.partner.efsllc.com/axis2/services/CardManagementWS/";
const IDEMPOTENCY = "11111111-1111-4111-8111-111111111111";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: KEY,
  EFS_CARD_CONTROL_ENABLED: "true",
} as NodeJS.ProcessEnv);

const ADMIN: AuthContext = { userId: "u-admin", email: "a@x.test", orgId: ORG, role: "admin" };

/**
 * Mounted on the `card_status` bucket's own path, so the limiter genuinely applies to it. A
 * capability on a path the pattern table does not recognise would leave the counter untouched for a
 * reason that has nothing to do with the gate under test — and pass.
 */
const gatedContract = defineContract({
  key: "test_gated",
  intent: "lock",
  scope: "lock",
  route: { method: "POST", path: "/:id/lock" },
  writeBucket: "card_status",
  auditAction: "card.locked",
  schema: z.object({
    expectedVersion: z.string().min(16),
    reason: z.string().default(""),
    uses: z.number().int().default(1),
  }),
  carriesSecret: false,
  vocabularyFields: [],
  emittableValues: {},
  ui: { title: "Test", verb: "Do the thing", tone: "warning", inputs: [], diffRows: [] },
});

const gatedBehaviour = defineBehaviour(gatedContract, {
  target: { kind: "card" },
  mutation: { kind: "echo", buildEdits: () => [] },
  verify: cardEchoVerify(),
  preflightStepUp: (body) => (body.uses > 3 ? "Confirm your password to do the thing." : null),
});

function seededClient(): SupabaseRecorder {
  return createSupabaseRecorder({
    rpc: { bump_card_write_counter: { allowed: true } },
    tables: {
      /**
       * Step 4.2. The gate now demands a promotion row per capability, so these fixtures model the
       * state migration 0193 backfills for every org whose write_entitlement is already confirmed.
       * Without it every write below refuses `not_promoted` — which is the gate working, and exactly
       * why the plan insists the backfill ship in the same change as the gate.
       */
      efs_capability_promotions: promotedCapabilitiesTable("test_gated"),
      efs_card_control_settings: {
        data: {
          org_id: ORG,
          enabled: true,
          write_entitlement: "confirmed",
          require_approver: false,
          probed_identity_hash: credentialIdentityHash(env, {
            endpointUrl: ENDPOINT, soapUsername: "user", accountId: null,
          }),
        },
      },
      efs_soap_credentials: [{
        org_id: ORG, environment: "sandbox", endpoint_url: ENDPOINT,
        soap_username: "user", soap_password: "pass", soap_password_sealed: null, account_id: null,
        posted_last_cursor: null, rejected_last_cursor: null,
        posted_last_polled_at: null, rejected_last_polled_at: null,
        posted_last_success_at: null, rejected_last_success_at: null,
        posted_last_error: null, rejected_last_error: null,
        enabled: true,
      }],
      efs_cards: [{ id: CARD_ID, org_id: ORG, card_number_sealed: seal(env, PAN, secretAad(ORG, "efs_card_pan")) }],
      efs_card_mutations: (query) =>
        query.write?.method === "insert"
          ? { data: { id: "mutation-1" }, error: null }
          : { data: [], error: null, count: 0 },
    },
  });
}

let server: Server;
let baseUrl = "";
let recorder: SupabaseRecorder;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  /**
   * A bare app, not `createApp`. The real one already mounts the generated router on
   * `/api/fuel-cards`, and an `app.use` after it APPENDS — so the test capability would never be
   * reached and the suite would quietly measure `card_lock` instead. Nothing being skipped matters
   * here: the write limiter lives inside `prepare()`, not in the app-level middleware chain, so it
   * runs exactly as it does in production.
   */
  const app = express();
  app.use(express.json());
  setAppLocals(app, {
    env,
    verifyToken: async (token: string): Promise<AuthContext> => {
      if (token !== "admin") throw new Error("bad token");
      return ADMIN;
    },
  });
  app.use("/api/fuel-cards", fuelCardCapabilityRouter(env, [mount(gatedContract, gatedBehaviour)]));
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

afterEach(() => { vi.unstubAllGlobals(); });

/** Captured before any stub replaces it, so the suite can still talk to its own server. */
const REAL_FETCH = globalThis.fetch;

const post = (uses: number): Promise<Response> => {
  recorder = seededClient();
  holder.client = recorder.client;
  // Anything reaching EFS is a test failure, not a network call: every case here is refused or
  // stopped before dispatch, and a real fetch would say so by hanging or throwing.
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("127.0.0.1")) return REAL_FETCH(input as Parameters<typeof fetch>[0], init);
    throw new Error("the vendor must not be dialled in this suite");
  }) as typeof fetch);
  return REAL_FETCH(`${baseUrl}/api/fuel-cards/${CARD_ID}/lock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer admin",
      "Idempotency-Key": IDEMPOTENCY,
    },
    body: JSON.stringify({ expectedVersion: "0123456789abcdef0123456789abcdef", uses }),
  });
};

const counterBumps = (): number =>
  recorder.rpcs().filter((call) => call.fn === "bump_card_write_counter").length;

describe("a body-only step-up refusal costs the operator nothing", () => {
  it("refuses without charging a slot against the daily cap", async () => {
    const res = await post(4);

    // 403 + `step_up_required`, the shape `stepUpRequired` writes and the drawer already handles.
    expect(res.status).toBe(403);
    const payload = await res.json() as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("step_up_required");
    // The capability's OWN sentence, not a generic one built from its verb. A gate that fires with
    // the wrong words sends a person to the wrong place.
    expect(payload.error.message).toBe("Confirm your password to do the thing.");
    // The assertion that matters. Reverse the two gates and this is 1: the operator is refused AND
    // billed, and after ten attempts at an action they were always allowed to take — they just had
    // to re-authenticate first — they are locked out of it for the rest of the minute.
    expect(counterBumps(), "a refused request charged the daily counter").toBe(0);
  });

  it("charges exactly one slot when the same capability is NOT refused", async () => {
    // The pair is what makes the case above mean something: without it, a limiter that was never
    // wired to this router at all would satisfy the zero-bump assertion perfectly.
    await post(1);
    expect(counterBumps()).toBe(1);
  });
});
