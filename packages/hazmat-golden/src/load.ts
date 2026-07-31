/**
 * Scenario loader (@hazmat/golden) — reads every `*.yaml` scenario file from the scenarios directory,
 * parses + validates each, and returns them with their source filenames. Files whose basename starts
 * with `_` are HARNESS EXAMPLES / self-tests authored by the implementer to demonstrate the runner; they
 * are NOT part of the SME-authored acceptance suite (see AUTHORING.md). `TEMPLATE.yaml` is skipped.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseScenario, type GoldenScenario } from "./schema.js";

export interface LoadedScenario {
  file: string;
  isExample: boolean;
  scenario: GoldenScenario;
}

export const SCENARIOS_DIR = fileURLToPath(new URL("../scenarios", import.meta.url));

export function loadScenarios(dir: string = SCENARIOS_DIR): LoadedScenario[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .filter((f) => f.toUpperCase() !== "TEMPLATE.YAML" && f.toUpperCase() !== "TEMPLATE.YML")
    .sort();
  const out: LoadedScenario[] = [];
  for (const f of files) {
    const raw = parseYaml(readFileSync(join(dir, f), "utf8"));
    out.push({ file: f, isExample: f.startsWith("_"), scenario: parseScenario(raw, f) });
  }
  return out;
}

/** The SME-authored acceptance scenarios (excludes the `_`-prefixed harness examples). */
export function acceptanceScenarios(loaded: LoadedScenario[]): LoadedScenario[] {
  return loaded.filter((l) => !l.isExample);
}
