import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openMetaTarget, type MetaTarget } from "./metaTarget.js";
import { committedReadings, diffReadings, GRAPH_READINGS, rerecord } from "./readings.js";

/**
 * The Publisher's OUR readings (fakeMeta.ts, fakeMetaAds.ts), re-recorded on whichever target ADS_TARGET
 * names and diffed against `readings.recorded.json` (stage2-kit). On the fake, every CI run: the fake still
 * answers what it committed to. On the sandbox, under `pnpm ads:certify`: Meta answers it too, or the
 * difference names the fake to correct.
 */

let target: MetaTarget;
beforeAll(async () => {
  target = await openMetaTarget();
});
afterAll(async () => {
  await target?.close();
});

describe("the Publisher's OUR readings, on the target", () => {
  it("every OUR reading of FakeMeta's Graph (fakeMeta.ts, fakeMetaAds.ts) answers on the target as committed", async () => {
    const differences = await rerecord("graph", GRAPH_READINGS, { ...target, token: target.token() });
    expect(differences).toEqual([]);
  });

  it("a planted difference fails, naming the reading, the field and the fake to correct", () => {
    const committed = committedReadings();
    const planted = structuredClone(committed);
    planted["error-envelope"]!.observed["error outside error"] = true;
    planted["error-envelope"]!.observed.status = 500;
    expect(diffReadings(committed, planted)).toEqual([
      'error-envelope "status": committed 400, target answered 500 — correct platforms/simulator/fakeMeta.ts',
      'error-envelope "error outside error": committed "(absent)", target answered true — correct platforms/simulator/fakeMeta.ts',
    ]);
    expect(diffReadings(committed, { "no-such": { fake: "x.ts", observed: {} } })).toEqual(["no-such: no committed reading — add it to readings.recorded.json from the fake"]);
  });
});
