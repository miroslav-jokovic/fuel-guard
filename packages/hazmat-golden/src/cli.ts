/**
 * CLI runner (@hazmat/golden) — `tsx src/cli.ts` runs the whole golden suite against the real shipped
 * dataset and prints a human-readable report; exits non-zero if any scenario fails. Useful for the
 * signed scenario-review log (plan H2 exit criteria).
 */

import { pathToFileURL } from "node:url";
import { loadDataset } from "@hazmat/data";
import { loadScenarios } from "./load.js";
import { runSuite } from "./runner.js";
import { formatSuite } from "./report.js";

export function runCli(): number {
  const dataset = loadDataset();
  const scenarios = loadScenarios().map((l) => l.scenario);
  const suite = runSuite(scenarios, dataset);
  process.stdout.write(formatSuite(suite) + "\n");
  return suite.allPassed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runCli());
}
