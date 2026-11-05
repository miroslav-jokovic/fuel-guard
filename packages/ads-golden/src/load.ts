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
import { parseMonitorScenario, type MonitorScenario } from "./monitorSchema.js";
import { parseScenario, type GoldenScenario } from "./schema.js";

export interface LoadedScenario {
  file: string;
  scenario: GoldenScenario;
}

export const SCENARIOS_DIR = fileURLToPath(new URL("../scenarios", import.meta.url));
/** A folder of its own: `loadScenarios` reads only its own level, so the orchestrator never meets these. */
export const MONITOR_SCENARIOS_DIR = join(SCENARIOS_DIR, "monitor");

export interface LoadedMonitorScenario {
  file: string;
  scenario: MonitorScenario;
}

/** One folder's scenarios through `parse`, sorted by file; names must be unique. */
function loadFrom<S extends { name: string }>(dir: string, parse: (raw: unknown, file: string) => S): Array<{ file: string; scenario: S }> {
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && !/^TEMPLATE\.ya?ml$/i.test(f))
    .sort();
  const out = files.map((f) => ({ file: f, scenario: parse(parseYaml(readFileSync(join(dir, f), "utf8")), f) }));
  const names = out.map((l) => l.scenario.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length > 0) throw new Error(`ads golden: scenario names must be unique — ${twice.join(", ")}`);
  return out;
}

export function loadScenarios(dir: string = SCENARIOS_DIR): LoadedScenario[] {
  return loadFrom(dir, parseScenario);
}

export function loadMonitorScenarios(dir: string = MONITOR_SCENARIOS_DIR): LoadedMonitorScenario[] {
  return loadFrom(dir, parseMonitorScenario);
}
