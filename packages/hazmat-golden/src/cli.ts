/**
 * CLI runner (@hazmat/golden) — `tsx src/cli.ts` runs the whole golden suite against the real shipped
 * dataset and prints a human-readable report; exits non-zero if any scenario fails. Useful for the
 * signed scenario-review log (plan H2 exit criteria).
 */

import { pathToFileURL } from "node:url";
import { loadDataset } from "@hazmat/data";
import { loadScenarios } from "./load.js";
import { runScenario } from "./runner.js";
import { formatSuite } from "./report.js";

export function runCli(): number {
  const scenarios = loadScenarios().map((l) => l.scenario);
  // Per-scenario dataset pins (H-LQ); default is the shipped LATEST.
  const results = scenarios.map((s) => runScenario(s, s.datasetVersion ? loadDataset(s.datasetVersion) : loadDataset()));
  const suite = { results, total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, allPassed: results.every((r) => r.passed) };
  process.stdout.write(formatSuite(suite) + "\n");
  return suite.allPassed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCli());
}
