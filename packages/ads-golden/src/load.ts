/**
 * Scenario loader (@silvicom/ads-golden) — every `*.yaml` under `scenarios/`, parsed and validated,
 * with its file name. `TEMPLATE.yaml` is skipped. Unlike `@hazmat/golden` there is no `_` example
 * class: every scenario here is part of the suite, because the Orchestrator's L3 row is "golden
 * scenarios green", not a count an SME grows toward.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { parseScenario, type GoldenScenario } from "./schema.js";

export interface LoadedScenario {
  file: string;
  scenario: GoldenScenario;
}

export const SCENARIOS_DIR = fileURLToPath(new URL("../scenarios", import.meta.url));

export function loadScenarios(dir: string = SCENARIOS_DIR): LoadedScenario[] {
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !/^TEMPLATE\.ya?ml$/i.test(f))
    .sort();
  const out: LoadedScenario[] = files.map((f) => ({ file: f, scenario: parseScenario(parseYaml(readFileSync(join(dir, f), "utf8")), f) }));
  const names = out.map((l) => l.scenario.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length > 0) throw new Error(`ads golden: scenario names must be unique — ${twice.join(", ")}`);
  return out;
}
