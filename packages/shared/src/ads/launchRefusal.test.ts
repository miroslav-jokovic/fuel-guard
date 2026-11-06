import { describe, expect, it } from "vitest";
import { AD_WORKER_OFFICE_LABEL, adsLaunchMissingSchema, adsRegistryWorkers, launchMissingLines } from "./launchRefusal.js";

describe("the launch gate's refusal, in office words (E3b-2)", () => {
  it("every worker the readiness registry names has office words, and no words name a worker it does not", () => {
    const named = adsRegistryWorkers().sort();
    expect(named.length).toBeGreaterThan(0);
    expect(Object.keys(AD_WORKER_OFFICE_LABEL).sort()).toEqual(named);
  });

  it("words each missing part by what it does, with the platform where it still needs a test run", () => {
    const missing = adsLaunchMissingSchema.parse([
      { worker: "Renderer / Higgsfield client", platform: null, level: "L3", needs: "L4" },
      { worker: "Publisher (per adapter)", platform: "meta", level: "L3", needs: "L4" },
    ]);
    expect(launchMissingLines(missing)).toEqual(["Making the pictures", "Putting the ads on the platform, on Meta (Facebook, Instagram)"]);
  });

  it("a worker or platform it has no words for is shown by name rather than dropped", () => {
    expect(launchMissingLines([{ worker: "Newcomer", platform: "snap", level: "L0", needs: "L4" }])).toEqual(["Newcomer, on snap"]);
  });
});
