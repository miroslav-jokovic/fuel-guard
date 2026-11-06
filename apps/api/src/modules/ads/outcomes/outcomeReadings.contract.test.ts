import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENTS_SANDBOX_VARIABLES, openMetaTarget, type MetaTarget } from "../platforms/meta/contract/metaTarget.js";
import { EVENTS_READINGS, rerecord } from "../platforms/meta/contract/readings.js";

/**
 * The Outcome feed's OUR readings (fakeMetaEvents.ts: the success body, the 7-day refusal), re-recorded on
 * whichever target ADS_TARGET names and diffed against `readings.recorded.json` (stage2-kit). Its L4 is
 * this file under `pnpm ads:certify "Outcome feed" --target sandbox`, with the Events Manager test code, so
 * no event it sends counts.
 */

let target: MetaTarget;
beforeAll(async () => {
  target = await openMetaTarget();
});
afterAll(async () => {
  await target?.close();
});

describe("the Outcome feed's OUR readings, on the target", () => {
  it("every OUR reading of FakeMeta's Conversions API (fakeMetaEvents.ts) answers on the target as committed", async () => {
    const missing = EVENTS_SANDBOX_VARIABLES.filter((k) => target.name === "sandbox" && !process.env[k]);
    if (missing.length > 0) throw new Error(`ADS_TARGET=sandbox needs ${missing.join(", ")} for the Conversions API readings — refusing rather than certifying half`);
    const differences = await rerecord("events", EVENTS_READINGS, { ...target, token: target.token() });
    expect(differences).toEqual([]);
  });
});
