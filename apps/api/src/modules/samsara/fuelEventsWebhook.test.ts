import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  verifySamsaraSignature,
  parseSamsaraFuelEvent,
  samsaraWebhookBootWarning,
  readSamsaraWebhookStatus,
  SAMSARA_WEBHOOK_PATH,
} from "./fuelEventsWebhook.js";
import { testEnv } from "../../testing/testEnv.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

const SECRET_B64 = Buffer.from("super-secret-key").toString("base64");
const env = testEnv({ SAMSARA_WEBHOOK_SECRET: SECRET_B64 });

function sign(ts: string, body: string): string {
  const mac = crypto
    .createHmac("sha256", Buffer.from(SECRET_B64, "base64"))
    .update(`v1:${ts}:`)
    .update(Buffer.from(body))
    .digest("hex");
  return `v1=${mac}`;
}

describe("verifySamsaraSignature", () => {
  const ts = "1720000000";
  const body = Buffer.from(JSON.stringify({ eventId: "e1" }));

  it("accepts a correctly signed request", () => {
    const signature = sign(ts, body.toString());
    expect(verifySamsaraSignature(env, body, { signature, timestamp: ts })).toBe(true);
  });
  it("rejects a tampered body", () => {
    const signature = sign(ts, body.toString());
    const tampered = Buffer.from(JSON.stringify({ eventId: "e2" }));
    expect(verifySamsaraSignature(env, tampered, { signature, timestamp: ts })).toBe(false);
  });
  it("fails closed with no secret / no headers", () => {
    expect(verifySamsaraSignature(testEnv(), body, { signature: "v1=x", timestamp: ts })).toBe(false);
    expect(verifySamsaraSignature(env, body, {})).toBe(false);
  });
});

describe("parseSamsaraFuelEvent", () => {
  it("parses a sudden fuel-drop alert and finds the vehicle id", () => {
    const ev = parseSamsaraFuelEvent({
      eventId: "evt-1",
      eventType: "AlertIncident",
      data: {
        happenedAtTime: "2026-07-01T10:00:00Z",
        conditions: [{ description: "Sudden Fuel Level Drop", details: { vehicle: { id: "212014918", name: "637" } } }],
      },
    });
    expect(ev.isFuelDrop).toBe(true);
    expect(ev.samsaraVehicleId).toBe("212014918");
    expect(ev.eventId).toBe("evt-1");
    expect(ev.happenedAt).toBe("2026-07-01T10:00:00Z");
  });

  it("does not treat a fuel RISE (refill) as a theft drop", () => {
    const ev = parseSamsaraFuelEvent({
      eventId: "evt-2",
      data: { conditions: [{ description: "Sudden Fuel Level Rise", details: { vehicle: { id: "1" } } }] },
    });
    expect(ev.isFuelDrop).toBe(false);
  });
});

describe("samsaraWebhookBootWarning", () => {
  // The defect S1 fixes in code. The receiver was already fail-closed and already correct; what it
  // was not, was AUDIBLE — an unset optional secret boots clean and then rejects every delivery for
  // as long as nobody thinks to look. Measured 2026-09-01: `fuel_events` = 0 rows, six months, no
  // error anywhere. This test is the one that would have made that a startup line instead.
  it("warns when the secret is unset, naming the path the receiver is mounted at", () => {
    const warning = samsaraWebhookBootWarning(testEnv());
    expect(warning).toContain("SAMSARA_WEBHOOK_SECRET");
    expect(warning).toContain(SAMSARA_WEBHOOK_PATH);
    expect(warning).toContain("401");
  });

  it("says nothing once the secret is configured", () => {
    expect(samsaraWebhookBootWarning(env)).toBeNull();
  });
});

describe("readSamsaraWebhookStatus", () => {
  const ORG = "org-1";

  it("reports a receiver that has never received anything, and is org-scoped", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_events: { data: [], count: 0 } } });
    const status = await readSamsaraWebhookStatus(rec.client, testEnv(), ORG);
    expect(status.secretConfigured).toBe(false);
    expect(status.eventCount).toBe(0);
    expect(status.lastEventAt).toBeNull();
    expect(status.endpointPath).toBe(SAMSARA_WEBHOOK_PATH);
    expectOrgScoped(rec, ORG);
  });

  // D-SAM7 in miniature: the figure is all-time, and the URL is printed whole so the operator pastes
  // it rather than reconstructs it — reconstructing it is how it came to be `/api/webhooks`.
  it("reports the last event and the exact URL to configure", async () => {
    const rec = createSupabaseRecorder({
      tables: { fuel_events: { data: [{ happened_at: "2026-08-30T12:00:00Z" }], count: 7 } },
    });
    const status = await readSamsaraWebhookStatus(
      rec.client,
      testEnv({ SAMSARA_WEBHOOK_SECRET: SECRET_B64, PUBLIC_API_URL: "https://api.example.test/" }),
      ORG,
    );
    expect(status.secretConfigured).toBe(true);
    expect(status.eventCount).toBe(7);
    expect(status.lastEventAt).toBe("2026-08-30T12:00:00Z");
    expect(status.endpointUrl).toBe("https://api.example.test/api/webhooks/samsara");
  });
});
