import { describe, it, expect } from "vitest";
import {
  applyFraudAttempt,
  cardFraudKey,
  failedPromptOf,
  foldFraudAttempts,
  opensFraudIncident,
  type FraudAttempt,
  type FraudIncident,
} from "./cardFraud.js";
import { classifyDeclineReason } from "./declineReason.js";

// Every decline of 2026-09-02..10-07 that kept `location_mismatch` or that EFS refused as "Merchant
// Position Too Far", verbatim from production (read-only, 2026-10-07; the query is in the chunk 5a
// PR). Columns: id prefix, declined_at, card tail, unit, city, state, samsara_location_matched,
// stored reason_category, error_description. No row carried `wrong_unit_number`. Card numbers are
// padded to the 19-digit shape the real rows have, so they key as full cards.
type Row = [string, string, string, string, string, string, boolean, string, string];
const rows: Row[] = [
  ["0bd0a8cd", "2026-09-07T09:18:00Z", "27975", "589", "AVOCA", "IA", true, "proximity_failure", "INVALID TRUCKSTOP IN0904907240|Merchant Position Too Far|"],
  ["df6ff285", "2026-09-11T10:01:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "proximity_failure", "INVALID TRUCKSTOP|Merchant Position Too Far|"],
  ["a52bba65", "2026-09-11T10:01:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "site_restriction", "INVALID TRUCKSTOP|Failed restrictions|"],
  ["96686153", "2026-09-11T21:04:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "card_not_active", "INACTIVE CARD|Non-Active Card|"],
  ["d5d07582", "2026-09-12T12:57:00Z", "37550", "506", "VANDALIA", "IL", true, "proximity_failure", "INVALID TRUCKSTOP IN0524630858|Merchant Position Too Far|"],
  ["b5662bf3", "2026-09-22T13:13:00Z", "07977", "768", "BOWMAN", "SC", true, "proximity_failure", "INVALID TRUCKSTOP IN0894710933|Merchant Position Too Far|"],
  ["420f9927", "2026-09-22T16:48:00Z", "57972", "649", "CORBIN", "KY", true, "proximity_failure", "INVALID TRUCKSTOP IN0914018844|Merchant Position Too Far|"],
  ["07640b64", "2026-09-22T19:24:00Z", "27564", "729", "SOUTH BEND", "IN", false, "invalid_info", "INVALID INFORMATION|ODOMETER|171662 IN0851404194||"],
  ["29f4da4c", "2026-09-22T19:24:00Z", "27564", "729", "SOUTH BEND", "IN", false, "invalid_info", "INVALID INFORMATION|ODOMETER|171662 IN0851404457||"],
  ["bec1fc30", "2026-09-22T20:45:00Z", "77960", "739", "WAYLAND", "MO", false, "card_not_active", "INACTIVE CARD IN0845001699|Non-Active Card|"],
  ["6dc0f862", "2026-09-23T00:16:00Z", "27564", "729", "SOUTH BEND", "IN", false, "card_not_active", "INACTIVE CARD IN0851565240|Non-Active Card|"],
  ["66149f54", "2026-09-23T13:36:00Z", "87149", "735", "HARRISONBURG", "VA", false, "card_not_active", "INACTIVE CARD|Non-Active Card|"],
  ["a4dc5f45", "2026-09-26T03:47:00Z", "37977", "799", "FRANKLIN", "KY", false, "invalid_info", "INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460506||"],
  ["0795f78e", "2026-09-26T03:47:00Z", "37977", "799", "FRANKLIN", "KY", false, "invalid_info", "INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460568||"],
  ["f14b7055", "2026-09-26T22:42:00Z", "37977", "799", "FRANKLIN", "KY", false, "card_not_active", "INACTIVE CARD IN0532837915|Non-Active Card|"],
  ["30bbd870", "2026-09-27T12:46:00Z", "27564", "729", "SOUTH BEND", "IN", false, "card_not_active", "INACTIVE CARD IN0854141423|Non-Active Card|"],
  ["470657f4", "2026-09-28T00:03:00Z", "07142", "744", "CHICOPEE", "MA", true, "proximity_failure", "INVALID TRUCKSTOP IN0917173474|Merchant Position Too Far|"],
  ["ef74e55a", "2026-10-01T22:50:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "card_not_active", "INACTIVE CARD IN0535688009|Non-Active Card|"],
  ["d6bebb68", "2026-10-03T15:07:00Z", "57976", "735", "DAVENPORT", "IA", true, "proximity_failure", "INVALID TRUCKSTOP IN0920559486|Merchant Position Too Far|"],
  ["42363b00", "2026-10-05T21:22:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "card_not_active", "INACTIVE CARD|Non-Active Card|"],
  ["955600f8", "2026-10-05T21:39:00Z", "07967", "555", "BALDWIN", "FL", false, "card_not_active", "INACTIVE CARD|Non-Active Card|"],
  ["1bedfa73", "2026-10-05T21:48:00Z", "07967", "555", "JACKSONVILLE", "FL", false, "card_not_active", "INACTIVE CARD IN0537832375|Non-Active Card|"],
];
const card = (tail: string) => `70830500000003${tail}`;
const attempts: FraudAttempt[] = rows.map(([id, at, tail, unit, city, state, matched, , desc]) => ({
  id,
  source: "decline",
  at,
  cardRef: card(tail),
  vehicleId: `veh-${unit}`,
  city,
  state,
  samsaraAtStation: matched,
  explainedByFill: false,
  reason: classifyDeclineReason(null, desc).category,
  failedPrompt: failedPromptOf(desc),
  truck: null,
}));
const until = (day: string) => attempts.filter((a) => a.at < day);
// The card-fraud plan's §1 window, measured 2026-10-02.
const planWindow = until("2026-10-03");
// The four "Merchant Position Too Far" declines that a good fill by the same truck followed (plan §1:
// Gretna 85 min after Avoca, Effingham 7 min after Vandalia, Bowman 6 min, Corbin 10 min).
const PROXIMITY_FOLLOWED = ["0bd0a8cd", "d5d07582", "b5662bf3", "420f9927"];
const steps = (i: FraudIncident | undefined) => i!.steps.map((s) => s.step);

describe("the fixture is production as stored", () => {
  it("the decline classifier reads every row as the scorer stored it", () => {
    expect(rows.map((r) => classifyDeclineReason(null, r[8]).category)).toEqual(rows.map((r) => r[7]));
  });
});

describe("foldFraudAttempts — 2026-09-02..10-02, the card-fraud plan's window", () => {
  const incidents = foldFraudAttempts(planWindow);
  const of = (tail: string) => incidents.filter((i) => i.cardRef === card(tail));

  it("13 attempts on 5 cards become 7 incidents, not 13 alerts", () => {
    expect(planWindow.filter(opensFraudIncident)).toHaveLength(13);
    expect(incidents).toHaveLength(7);
    expect(new Set(incidents.map((i) => i.cardRef)).size).toBe(5);
    expect(incidents.flatMap((i) => i.attemptIds)).toHaveLength(13);
  });

  it("the four proximity declines a good fill followed open no incident", () => {
    const four = attempts.filter((a) => PROXIMITY_FOLLOWED.includes(a.id));
    expect(four).toHaveLength(4);
    expect(foldFraudAttempts(four)).toEqual([]);
    expect(incidents.flatMap((i) => i.attemptIds).filter((id) => PROXIMITY_FOLLOWED.includes(id))).toEqual([]);
  });

  it("…27564 South Bend 09-22: opens escalated on the failed odometer prompt, and the later tries send nothing more", () => {
    const [first, second] = of("27564");
    expect(first!.attemptIds).toEqual(["07640b64", "29f4da4c", "6dc0f862"]);
    expect(first!.level).toBe("escalated");
    expect(first!.failedPrompts).toEqual(["odometer"]);
    expect(steps(first)).toEqual(["opened"]);
    // 09-23 00:16 → 09-27 12:46 is 108 hours: past the 72-hour join, so a new incident.
    expect(second!.attemptIds).toEqual(["30bbd870"]);
  });

  it("…07967 Jacksonville 09-11: opens on the proximity decline, escalates on the inactive-card return 11 hours later", () => {
    const [sept, oct] = of("07967");
    expect(sept!.attemptIds).toEqual(["a52bba65", "df6ff285", "96686153"]);
    expect(steps(sept)).toEqual(["opened", "escalated"]);
    expect(sept!.places).toEqual([
      { city: "JACKSONVILLE", state: "FL", attempts: 3, firstAt: "2026-09-11T10:01:00Z", lastAt: "2026-09-11T21:04:00Z" },
    ]);
    expect(oct!.attemptIds).toEqual(["ef74e55a"]);
  });

  it("…37977 Franklin: one incident, opened escalated on the failed driver-ID prompt", () => {
    expect(of("37977")).toHaveLength(1);
    expect(of("37977")[0]!.failedPrompts).toEqual(["driver_id"]);
    expect(steps(of("37977")[0])).toEqual(["opened"]);
    expect(of("37977")[0]!.attemptIds).toHaveLength(3);
  });

  it("…77960 Wayland and …87149 Harrisonburg: one attempt, one incident each", () => {
    expect(of("77960").map((i) => i.attemptIds)).toEqual([["bec1fc30"]]);
    expect(of("87149").map((i) => i.attemptIds)).toEqual([["66149f54"]]);
  });

  it("13 alerts become 8 notifications: seven openings and one escalation", () => {
    expect(incidents.flatMap((i) => i.steps)).toHaveLength(8);
  });

  it("is the same whatever order the history arrives in", () => {
    expect(foldFraudAttempts([...planWindow].reverse())).toEqual(incidents);
  });
});

describe("foldFraudAttempts — through 2026-10-07", () => {
  const incidents = foldFraudAttempts(attempts);

  it("Chicopee and Davenport (Samsara: the truck was there) open nothing either", () => {
    const ids = incidents.flatMap((i) => i.attemptIds);
    expect(ids).not.toContain("470657f4");
    expect(ids).not.toContain("d6bebb68");
  });

  it("…07967 is back on 10-05: a third incident, and Baldwin is a new place that interrupts once", () => {
    expect(incidents).toHaveLength(8);
    const latest = incidents.filter((i) => i.cardRef === card("07967")).at(-1)!;
    expect(latest.attemptIds).toEqual(["42363b00", "955600f8", "1bedfa73"]);
    expect(steps(latest)).toEqual(["opened", "new_place"]);
    expect(latest.places.map((p) => [p.city, p.attempts])).toEqual([["JACKSONVILLE", 2], ["BALDWIN", 1]]);
  });
});

describe("applyFraudAttempt — the reducer a scorer calls", () => {
  // Jacksonville 09-11 10:01: a qualifying attempt with no escalation sign of its own.
  const base = attempts.find((a) => a.id === "df6ff285")!;
  const at = (o: Partial<FraudAttempt>): FraudAttempt => ({ ...base, ...o });
  const open = () => applyFraudAttempt(null, base).incident!;

  it("only an attempt Samsara places away from the station, unexplained by a fill, opens an incident", () => {
    expect(applyFraudAttempt(null, at({ samsaraAtStation: true }))).toEqual({ incident: null, step: null });
    expect(applyFraudAttempt(null, at({ samsaraAtStation: null }))).toEqual({ incident: null, step: null });
    expect(applyFraudAttempt(null, at({ explainedByFill: true }))).toEqual({ incident: null, step: null });
    expect(applyFraudAttempt(null, base)).toMatchObject({ step: "opened", incident: { level: "alert" } });
  });

  it("an attempt that does not qualify never joins an open incident", () => {
    const incident = open();
    const r = applyFraudAttempt(incident, at({ id: "ok", at: "2026-09-11T11:00:00Z", samsaraAtStation: true }));
    expect(r).toEqual({ incident, step: null });
  });

  it("a re-scored attempt is a no-op, never a second message", () => {
    const incident = open();
    expect(applyFraudAttempt(incident, base)).toEqual({ incident, step: null });
  });

  it("the join window is inclusive at 72 hours and opens a new incident one minute past it", () => {
    const incident = open();
    expect(applyFraudAttempt(incident, at({ id: "y", at: "2026-09-14T10:01:00Z" })).incident!.key).toBe(incident.key);
    const past = applyFraudAttempt(incident, at({ id: "z", at: "2026-09-14T10:02:00Z" }));
    expect(past.step).toBe("opened");
    expect(past.incident!.key).not.toBe(incident.key);
  });

  it("a repeat at the same place escalates only after the full six hours", () => {
    const incident = open();
    expect(applyFraudAttempt(incident, at({ id: "r1", at: "2026-09-11T16:00:59Z" })).step).toBeNull();
    expect(applyFraudAttempt(incident, at({ id: "r2", at: "2026-09-11T16:01:00Z" })).step).toBe("escalated");
  });

  it("each sign escalates: a failed odometer or driver-ID prompt, an inactive card, fuel taken", () => {
    for (const sign of [
      { failedPrompt: "odometer" as const },
      { failedPrompt: "driver_id" as const },
      { reason: "card_not_active" as const },
      { source: "fill" as const, reason: null },
    ]) {
      const r = applyFraudAttempt(open(), at({ id: "s", at: "2026-09-11T10:30:00Z", ...sign }));
      expect(r.step).toBe("escalated");
      expect(r.incident!.level).toBe("escalated");
    }
  });

  it("a new place interrupts; one attempt that is both new and escalating sends one step", () => {
    const moved = applyFraudAttempt(open(), at({ id: "p", at: "2026-09-11T12:00:00Z", city: "BALDWIN" }));
    expect(moved.step).toBe("new_place");
    expect(moved.incident!.level).toBe("alert");
    const both = applyFraudAttempt(open(), at({ id: "q", at: "2026-09-11T12:00:00Z", city: "BALDWIN", reason: "card_not_active" }));
    expect(both.step).toBe("escalated");
    expect(both.incident!.steps).toHaveLength(2);
  });

  it("an escalated incident does not escalate again, and a plain attempt does not bring it back down", () => {
    const up = applyFraudAttempt(open(), at({ id: "e1", at: "2026-09-11T10:30:00Z", reason: "card_not_active" })).incident!;
    expect(applyFraudAttempt(up, at({ id: "e2", at: "2026-09-11T10:40:00Z", failedPrompt: "odometer" })).step).toBeNull();
    const plain = applyFraudAttempt(up, at({ id: "e3", at: "2026-09-11T10:50:00Z", city: "BALDWIN" }));
    expect(plain.step).toBe("new_place");
    expect(plain.incident!.level).toBe("escalated");
  });

  it("a closed incident is never joined", () => {
    const r = applyFraudAttempt({ ...open(), closed: true }, at({ id: "n", at: "2026-09-11T11:00:00Z" }));
    expect(r.step).toBe("opened");
    expect(r.incident!.key).not.toBe(open().key);
  });

  it("history arriving late joins but interrupts nobody", () => {
    const r = applyFraudAttempt(open(), at({ id: "old", at: "2026-09-11T08:00:00Z", city: "BALDWIN", reason: "card_not_active" }));
    expect(r.step).toBeNull();
    expect(r.incident!.lastAttemptAt).toBe("2026-09-11T10:01:00Z");
    expect(r.incident!.attemptIds).toContain("old");
  });
});

describe("failedPromptOf — the pump prompt only the driver knows", () => {
  it("reads the prompt from the description's second field", () => {
    expect(failedPromptOf("INVALID INFORMATION|ODOMETER|171662 IN0851404194||")).toBe("odometer");
    expect(failedPromptOf("INVALID INFORMATION|ODOMETER IN0828164576|")).toBe("odometer");
    expect(failedPromptOf("INVALID INFORMATION|DRIVER ID|ODOMETER IN0532460568||")).toBe("driver_id");
  });
  it("is null for the unit number (the everyday typo) and for anything that is not a prompt", () => {
    expect(failedPromptOf("INVALID INFORMATION|UNIT NUMBER|")).toBeNull();
    expect(failedPromptOf("INACTIVE CARD|Non-Active Card|")).toBeNull();
    expect(failedPromptOf(null)).toBeNull();
  });
});

describe("cardFraudKey", () => {
  it("a full card number is the card; a masked one only counts together with its truck", () => {
    expect(cardFraudKey(card("27564"), "veh-729")).toBe(card("27564"));
    expect(cardFraudKey("XXXXXXXXXXXX7564", "veh-729")).not.toBe(cardFraudKey("XXXXXXXXXXXX7564", "veh-730"));
  });
});
