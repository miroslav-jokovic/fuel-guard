import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `POST /api/card-fraud-incidents/:id/transition` (chunk 8c2). The gate is `fuel: manage` (Q-F11 (a)),
 * every accepted move writes one audit row, and a bad body never reaches the table.
 */
const holder = vi.hoisted(() => ({ rec: null as SupabaseRecorder | null }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.rec!.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID = "44444444-4444-4444-8444-444444444444";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const FULL_CARD = "7083050000000107967";
const INCIDENT_ROW = {
  id: ID, status: "open", version: 1, disposition: null, resolution_note: null, card_ref: FULL_CARD,
  vehicle_id: "66666666-6666-4666-8666-666666666666", opened_at: "2026-10-05T14:10:00Z", last_attempt_at: "2026-10-05T16:00:00Z",
  level: "alert", attempt_count: 1, fuel_taken: false, failed_prompts: [], places: [{ city: "Jacksonville", state: "FL", attempts: 1 }],
  last_truck: null,
};
const as = (role: AuthContext["role"]): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });

let server: Server;
let baseUrl = "";
let auth: AuthContext = as("admin");

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
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
afterAll(async () => closeTestServer(server));
beforeEach(() => {
  auth = as("admin");
  holder.rec = createSupabaseRecorder({
    tables: {
      card_fraud_incidents: (q: RecordedQuery) => (q.write ? [{ id: ID, version: 2 }] : [INCIDENT_ROW]),
      card_fraud_incident_attempts: [{ source: "decline", attempted_at: "2026-10-05T14:10:00Z", step: "opened" }],
      vehicles: [{ unit_number: "555" }],
      audit_logs: [],
    },
  });
});

const post = (body: unknown) =>
  fetch(`${baseUrl}/api/card-fraud-incidents/${ID}/transition`, {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const dismiss = { status: "dismissed", note: "Driver was in the truck", disposition: "false_positive", version: 1 };
const audits = () => holder.rec!.writtenRows("audit_logs");

describe("closing a card-fraud incident over HTTP", () => {
  it("lets a fuel manager close one, and writes one audit row naming the move", async () => {
    const res = await post(dismiss);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "dismissed", version: 2 });
    expect(audits()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({
      org_id: ORG, actor_id: "u-admin", action: "card_fraud.status_changed", entity: "card_fraud_incidents", entity_id: ID,
    });
    expect((audits()[0] as { meta: unknown }).meta).toMatchObject({ from: "open", to: "dismissed", disposition: "false_positive" });
    expectOrgScoped(holder.rec!, ORG);
  });

  it("refuses a safety manager, who sees incidents but does not manage fuel", async () => {
    auth = as("safety_manager");
    expect((await post(dismiss)).status).toBe(403);
    expect(holder.rec!.writtenRows("card_fraud_incidents")).toHaveLength(0);
  });

  it("refuses a close with no disposition or no note before touching the table", async () => {
    expect((await post({ ...dismiss, disposition: undefined })).status).toBe(400);
    expect((await post({ ...dismiss, note: "" })).status).toBe(400);
    expect(holder.rec!.forTable("card_fraud_incidents")).toHaveLength(0);
  });

  it("answers 409 and writes no audit row on a stale version", async () => {
    const res = await post({ ...dismiss, version: 7 });
    expect(res.status).toBe(409);
    expect(audits()).toHaveLength(0);
  });
});

describe("reading a card-fraud incident for the drawer (chunk 8c3)", () => {
  const get = () => fetch(`${baseUrl}/api/card-fraud-incidents/${ID}`, { headers: { Authorization: "Bearer token" } });

  it("returns it to a fuel viewer with the card's last four only, its attempts and its truck, org-scoped", async () => {
    auth = as("accountant");
    const res = await get();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FULL_CARD);
    const { incident } = JSON.parse(text) as { incident: Record<string, unknown> };
    expect(incident).toMatchObject({ cardLast4: "7967", unitNumber: "555", status: "open", version: 1 });
    expect(incident.attempts).toEqual([{ source: "decline", attemptedAt: "2026-10-05T14:10:00Z", step: "opened" }]);
    expectOrgScoped(holder.rec!, ORG);
  });

  it("refuses a role without fuel", async () => {
    auth = as("technician");
    expect((await get()).status).toBe(403);
  });

  it("answers 404 for an incident outside the caller's org", async () => {
    holder.rec = createSupabaseRecorder({ tables: { card_fraud_incidents: [] } });
    expect((await get()).status).toBe(404);
  });
});
