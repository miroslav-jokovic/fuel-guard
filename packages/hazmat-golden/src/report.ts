/**
 * Golden report formatter (@hazmat/golden) — renders a suite result as a human-readable report for the
 * CLI runner and for review logs.
 */

import type { SuiteResult, ScenarioResult } from "./runner.js";

function fmt(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function formatScenario(r: ScenarioResult): string {
  const head = `${r.passed ? "✓" : "✗"} ${r.name}  [${r.verifiedBy}]  (${r.docRef})`;
  if (r.passed) return head;
  const lines = [head];
  if (r.error) lines.push(`    ERROR: ${r.error}`);
  for (const f of r.failures) lines.push(`    - ${f.field}: expected ${fmt(f.expected)}, got ${fmt(f.actual)}`);
  return lines.join("\n");
}

export function formatSuite(s: SuiteResult): string {
  const L: string[] = ["# HazmatGuard golden acceptance suite (plan H2)", ""];
  for (const r of s.results) L.push(formatScenario(r));
  L.push("");
  L.push(`${s.allPassed ? "PASS" : "FAIL"} — ${s.passed}/${s.total} scenarios passed` + (s.failed ? `, ${s.failed} failed` : ""));
  return L.join("\n");
}
