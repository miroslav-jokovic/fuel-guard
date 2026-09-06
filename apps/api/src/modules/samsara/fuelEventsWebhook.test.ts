import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  verifySamsaraSignature,
  parseSamsaraFuelEvent,
  samsaraWebhookBootWarning,
  readSamsaraWebhookStatus,
  processSamsaraWebhook,
  SAMSARA_WEBHOOK_PATH,
} from "./fuelEventsWebhook.js";
import { FUEL_EVENT_DROP, FUEL_EVENT_DROP_UNVERIFIED } from "../fuel/index.js";
import { testEnv } from "../../testing/testEnv.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../testing/supabaseRecorder.js";

/**
 * A `fuel_events` fixture that answers according to the `event_type` filter actually applied.
 *
 * A flat `{ count: n }` fixture answers all three of the reader's queries with the same n, so a
 * reader that dropped the `event_type` filter — or filtered on the wrong member of the vocabulary —
 * would pass unchanged. That is the recorder's whole reason for existing (`supabaseRecorder.ts`
 * header), and it matters especially here because until 2026-09-06 no reader filtered that column at
 * all, so there was no existing behaviour to accidentally keep.
 */
function fuelEventsByType(counts: Record<string, number>, lastAt: string | null = null) {
  return (q: RecordedQuery) => {
    const type = q.filters().find((f) => f.col === "event_type")?.val as string | undefined;
    if (type == null) return { data: lastAt ? [{ happened_at: lastAt }] : [], count: 0 };
    return { data: [], count: counts[type] ?? 0 };
  };
}

const DROP_BODY = {
  eventId: "evt-9",
  eventType: "AlertIncident",
  data: {
    happenedAtTime: "2026-09-06T10:00:00Z",
    conditions: [{ description: "Sudden Fuel Level Drop", details: { vehicle: { id: "sv-1" } } }],
  },
};

function signedDelivery(body: object) {
  const raw = Buffer.from(JSON.stringify(body));
  const ts = "1720000000";
  return { raw, headers: { signature: sign(ts, raw.toString()), timestamp: ts } };
}

/** Let the fire-and-forget `notifyFuelDrop` reach its first await before asserting on it. */
const settle = () => new Promise((r) => setImmediate(r));

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
      tables: { fuel_events: fuelEventsByType({ [FUEL_EVENT_DROP]: 7 }, "2026-08-30T12:00:00Z") },
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

describe("the webhook's fuel-sensor reliability gate", () => {
  const vehicles = (tankSensorReliable: boolean | null) => ({
    data: [{ id: "veh-1", org_id: "org-1", unit_number: "637", tank_sensor_reliable: tankSensorReliable }],
  });

  // The defect this closes, measured 2026-09-06: `fileDropsFor` gates the FEED-derived drop on
  // `tank_sensor_reliable`, this path gated on nothing, and the column is true for 12 of 195 trucks —
  // so one table, reached two ways, held 94% of its rows to no standard at all.
  it("stores a drop from an untrusted sensor as unverified, and emails nobody", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: vehicles(null) } });
    const { raw, headers } = signedDelivery(DROP_BODY);

    const result = await processSamsaraWebhook(rec.client, env, raw, headers);
    await settle();

    expect(result).toEqual({ ok: true, stored: true, reason: "unreliable_sensor" });
    expect(rec.writtenRows("fuel_events")[0]!.event_type).toBe(FUEL_EVENT_DROP_UNVERIFIED);
    // The notification reads `organizations`; never touching that table is how we know nobody was told.
    expect(rec.forTable("organizations")).toHaveLength(0);
  });

  it("stores a drop from a learned-reliable sensor as siphoning evidence, and does tell somebody", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: vehicles(true) } });
    const { raw, headers } = signedDelivery(DROP_BODY);

    const result = await processSamsaraWebhook(rec.client, env, raw, headers);
    await settle();

    expect(result).toEqual({ ok: true, stored: true });
    expect(rec.writtenRows("fuel_events")[0]!.event_type).toBe(FUEL_EVENT_DROP);
    expect(rec.forTable("organizations")).not.toHaveLength(0);
  });

  // The gate's own failure mode, and the reason a suppressed drop is stored rather than discarded:
  // `eventCount` answers "has this receiver ever received anything", so a discarding gate would make
  // a perfectly working webhook report itself as one nothing has ever reached — S1's false reading,
  // re-introduced through the back door of a correctness fix.
  it("does not report a receiver as never-reached when every drop it received was held back", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fuel_events: fuelEventsByType({ [FUEL_EVENT_DROP_UNVERIFIED]: 3 }, "2026-09-06T10:00:00Z"),
      },
    });

    const status = await readSamsaraWebhookStatus(rec.client, env, "org-1");

    expect(status.eventCount).toBe(0);
    expect(status.unverifiedCount).toBe(3);
    expect(status.lastEventAt).toBe("2026-09-06T10:00:00Z");
    expectOrgScoped(rec, "org-1");
  });
});
