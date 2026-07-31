/**
 * Golden runner (@hazmat/golden) — executes one scenario through the REAL engine against the REAL
 * shipped dataset and checks the independently-authored `expect`. Pure and deterministic: the caller
 * supplies the dataset + a fixed `evaluatedAt`, so a scenario's result never depends on wall-clock time.
 *
 * The runner NEVER authors expectations — it only compares the verdict to what a human already wrote.
 */

import { evaluateLoad, validateBol, type LoadInput, type Verdict } from "@hazmat/engine";
import type { Dataset } from "@hazmat/data";
import type { GoldenScenario } from "./schema.js";

export interface CheckFailure {
  field: string;
  expected: unknown;
  actual: unknown;
}
export interface ScenarioResult {
  name: string;
  docRef: string;
  verifiedBy: string;
  passed: boolean;
  failures: CheckFailure[];
  error?: string;
}

const DEFAULT_CLOCK = "2026-07-31T00:00:00Z";

function buildInput(scenario: GoldenScenario, dataset: Dataset): LoadInput {
  const input = scenario.input as Record<string, unknown>;
  return {
    evaluatedAt: DEFAULT_CLOCK,
    ...input,
    dataset: dataset as unknown,
  } as unknown as LoadInput;
}

export function runScenario(scenario: GoldenScenario, dataset: Dataset): ScenarioResult {
  const base = { name: scenario.name, docRef: scenario.docRef, verifiedBy: scenario.verifiedBy };
  let verdict: Verdict;
  try {
    verdict = evaluateLoad(buildInput(scenario, dataset));
  } catch (err) {
    return { ...base, passed: false, failures: [], error: err instanceof Error ? err.message : String(err) };
  }

  const failures: CheckFailure[] = [];
  const fail = (field: string, expected: unknown, actual: unknown): void => {
    failures.push({ field, expected, actual });
  };
  const e = scenario.expect;

  if (e.eligibility && verdict.eligibility.status !== e.eligibility) {
    fail("eligibility", e.eligibility, verdict.eligibility.status);
  }

  const required = verdict.placards.required.map((r) => r.placard);
  const requiredSet = new Set<string>(required);
  for (const p of e.placardsRequired) if (!requiredSet.has(p)) fail(`placardsRequired: ${p}`, p, required);
  for (const p of e.placardsAbsent) if (requiredSet.has(p)) fail(`placardsAbsent (was required): ${p}`, "(absent)", required);

  const prohibited = new Set<string>(verdict.placards.prohibited.map((r) => r.placard));
  for (const p of e.placardsProhibited) if (!prohibited.has(p)) fail(`placardsProhibited: ${p}`, p, [...prohibited]);

  const subs = verdict.placards.optionalSubstitutions.map((s) => `${s.instead}->${s.use}`);
  const subSet = new Set(subs);
  for (const s of e.optionalSubstitutions) {
    const key = `${s.instead}->${s.use}`;
    if (!subSet.has(key)) fail(`optionalSubstitution: ${key}`, key, subs);
  }

  const idSet = new Set<string>(verdict.placards.idDisplays.map((d) => d.idNumber));
  for (const id of e.idDisplays) if (!idSet.has(id)) fail(`idDisplays: ${id}`, id, [...idSet]);

  for (const g of e.ergGuides) {
    const hit = verdict.placards.ergGuides.find((x) => x.idNumber === g.idNumber);
    if (!hit) fail(`ergGuide missing: ${g.idNumber}`, g, "(none)");
    else if (hit.guide !== g.guide) fail(`ergGuide ${g.idNumber} guide`, g.guide, hit.guide);
  }

  const markSet = new Set<string>(verdict.placards.marks.map((m) => m.mark));
  for (const m of e.marks) if (!markSet.has(m)) fail(`marks: ${m}`, m, [...markSet]);

  const allFindingIds = new Set<string>([...verdict.eligibility.blocks, ...verdict.segregation].map((f) => f.ruleId));
  for (const id of e.findingRuleIds) if (!allFindingIds.has(id)) fail(`findingRuleId: ${id}`, id, [...allFindingIds]);

  const segIds = new Set<string>(verdict.segregation.map((f) => f.ruleId));
  for (const id of e.segregationRuleIds) if (!segIds.has(id)) fail(`segregationRuleId: ${id}`, id, [...segIds]);

  for (const id of e.absentRuleIds) if (allFindingIds.has(id)) fail(`absentRuleId (present): ${id}`, "(absent)", [...allFindingIds]);

  if (e.bol) {
    if (!scenario.runBol) {
      fail("bol expectations present but runBol is false", "runBol: true", scenario.runBol);
    } else {
      const bol = validateBol(buildInput(scenario, dataset));
      e.bol.basicDescriptions.forEach((bd, i) => {
        const got = bol.lines[i]?.basicDescription;
        if (got !== bd) fail(`bol.lines[${i}].basicDescription`, bd, got);
      });
      const bolText = JSON.stringify(bol);
      for (const s of e.bol.mustContain) if (!bolText.includes(s)) fail(`bol.mustContain: ${s}`, s, "(not found in BOL output)");
      const bolIds = new Set<string>(bol.findings.map((f) => f.ruleId));
      for (const id of e.bol.findingRuleIds) if (!bolIds.has(id)) fail(`bol.findingRuleId: ${id}`, id, [...bolIds]);
    }
  }

  return { ...base, passed: failures.length === 0, failures };
}

export interface SuiteResult {
  results: ScenarioResult[];
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
}

export function runSuite(scenarios: GoldenScenario[], dataset: Dataset): SuiteResult {
  const results = scenarios.map((s) => runScenario(s, dataset));
  const passed = results.filter((r) => r.passed).length;
  return { results, total: results.length, passed, failed: results.length - passed, allPassed: passed === results.length };
}
