import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifySamsaraSignature, parseSamsaraFuelEvent } from "./fuelEvents.js";
import type { Env } from "../env.js";

const SECRET_B64 = Buffer.from("super-secret-key").toString("base64");
const env = { SAMSARA_WEBHOOK_SECRET: SECRET_B64 } as unknown as Env;

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
    expect(verifySamsaraSignature({} as Env, body, { signature: "v1=x", timestamp: ts })).toBe(false);
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
