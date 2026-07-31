import { describe, expect, it } from "vitest";
import { loadDataset } from "@hazmat/data";
import { loadScenarios, acceptanceScenarios } from "./load.js";
import { runScenario, runSuite } from "./runner.js";
import { formatScenario } from "./report.js";

const dataset = loadDataset();
const loaded = loadScenarios();

describe("@hazmat/golden — acceptance suite (plan H2)", () => {
  it("loads scenarios and every one carries a `verifiedBy` (independent-authorship provenance)", () => {
    expect(loaded.length).toBeGreaterThan(0);
    for (const l of loaded) expect(l.scenario.verifiedBy.trim().length).toBeGreaterThan(0);
  });

  it("ALL scenarios pass against the real shipped dataset", () => {
    const suite = runSuite(loaded.map((l) => l.scenario), dataset);
    if (!suite.allPassed) {
      const detail = suite.results.filter((r) => !r.passed).map(formatScenario).join("\n");
      throw new Error(`golden suite has ${suite.failed} failing scenario(s):\n${detail}`);
    }
    expect(suite.allPassed).toBe(true);
  });

  // NEGATIVE CONTROL: prove the checker is not vacuous — a deliberately-wrong expectation MUST fail.
  it("catches a wrong expectation (checker is not vacuous)", () => {
    const good = loaded.find((l) => l.file.includes("gasoline-cargo-tank"))!.scenario;
    const passed = runScenario(good, dataset);
    expect(passed.passed).toBe(true);

    const wrong = { ...good, expect: { ...good.expect, eligibility: "blocked" as const } };
    const failed = runScenario(wrong, dataset);
    expect(failed.passed).toBe(false);
    expect(failed.failures.some((f) => f.field === "eligibility")).toBe(true);
  });

  // The acceptance suite is authored by the SME (Marija Varmeda), not the implementer. Until it lands,
  // only the "_" harness examples exist. This is a visibility check, not a hard gate — it must not
  // silently read as "covered". The launch target is ≥400 SME-authored scenarios (plan H2).
  it("reports SME-authored acceptance coverage (target ≥400 at launch)", () => {
    const acceptance = acceptanceScenarios(loaded);
    const examples = loaded.length - acceptance.length;
    // eslint-disable-next-line no-console
    console.log(`golden coverage — acceptance(SME-authored): ${acceptance.length}, harness examples: ${examples}, target: 400`);
    expect(loaded.length).toBeGreaterThanOrEqual(examples); // always true; keeps the count visible in output
  });
});
