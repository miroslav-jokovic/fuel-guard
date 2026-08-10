/**
 * checkSegregation (plan H2) — the §177.848(d) load-compatibility check.
 *
 * Given the materials on one transport vehicle, it reads the §177.848(d) class×class grid (from the
 * dataset the caller passed in) and reports every restricted pair. Grid values: `X` = may NOT be
 * loaded/transported/stored together (violation); `O` = "away from" — allowed only with the required
 * separation (conditional); `*` = the specific segregation in §177.848 applies — review the note
 * (conditional). A blank cell = no restriction. Class 9 and combustible liquids are not in the grid,
 * so they carry no §177.848(d) restriction.
 *
 * Pure function; reads the dataset through a minimal consumer view (the engine may not import
 * @hazmat/data). Never under-restricts: when a class maps to several qualified grid labels (e.g. the
 * two 2.3 zones), it takes the most severe applicable value.
 *
 * SUBSIDIARY classes count. §177.848 segregates on hazard, and a material's subsidiary risk is a
 * hazard it actually carries — a Class 3 flammable with a subsidiary 4.3 is dangerous-when-wet on
 * the truck regardless of what its primary class says. This check used to build its class set from
 * `hazardClass` alone, so that load beside a Class 8 corrosive produced `segregation_none` at tier
 * `info`: an explicit "no restriction applies" standing in for a real 4.3 × 8 restriction. The same
 * dataset field was already being read one module over — `computePlacards` uses it for the §172.505
 * subsidiary placards — so the engine knew the hazard and the segregation check simply did not ask
 * (audit 2026-08-09, finding 4.2).
 */

import type { Finding, LoadInput, TraceNode } from "../types.js";

interface DsEntry { entryId: string; hazardClass: string | null; subsidiaryClasses?: string[] }
interface DsSegCell { rowClass: string; colClass: string; value: "X" | "O" | "*"; notes: string | null }
interface DsView { entries: DsEntry[]; segregation: DsSegCell[] }

function readDataset(load: LoadInput): DsView {
  const d = load.dataset as unknown as Partial<DsView>;
  return {
    entries: Array.isArray(d.entries) ? d.entries : [],
    segregation: Array.isArray(d.segregation) ? d.segregation : [],
  };
}

/** Leading class/division token: "6.1 liquids PG I zone A" → "6.1"; "3" → "3". */
function baseClass(s: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(s);
  return m ? (m[1] as string) : s.trim().toLowerCase();
}

const SEVERITY: Record<string, number> = { X: 3, "*": 2, O: 1 };

export interface SegregationResult {
  findings: Finding[];
  trace: TraceNode[];
  hasViolation: boolean;
  /** G8 (M5.2): false when the dataset carried no segregation grid — the check COULD NOT run. */
  gridPresent: boolean;
}

export function checkSegregation(load: LoadInput): SegregationResult {
  const ds = readDataset(load);
  const trace: TraceNode[] = [];
  const findings: Finding[] = [];

  if (ds.segregation.length === 0) {
    // G8 (M5.2): an absent grid is a FAIL-CLOSED condition, not a silent pass — compatibility was
    // not checked, so the verdict must say so and eligibility must not reach `eligible`.
    trace.push({ ruleId: "segregation_grid_present", fired: false, inputs: { cells: 0 }, citations: [] });
    findings.push({
      ruleId: "segregation_grid_unavailable",
      tier: "conditional",
      message: "The dataset carries no §177.848 segregation grid — load compatibility was NOT checked.",
      citations: [{ cfr: "49 CFR §177.848(d)" }],
      evidence: { cells: 0 },
    });
    return { findings, trace, hasViolation: false, gridPresent: false };
  }

  // Distinct hazard classes on the load, PRIMARY AND SUBSIDIARY, with a note of where each came
  // from. The provenance is not decoration: "Class 4.3 and Class 8 may not be loaded together" sends
  // a loader looking for a 4.3 placard that is not on the paperwork, whereas "Class 4.3 (subsidiary
  // risk of gas — UN1203) and Class 8" names the drum they are actually holding.
  const classSources = new Map<string, Set<string>>();
  const noteClass = (raw: string | null | undefined, entryId: string, kind: "class" | "subsidiary") => {
    const text = (raw ?? "").trim();
    if (!text) return;
    const base = baseClass(text);
    if (!base) return;
    if (!classSources.has(base)) classSources.set(base, new Set<string>());
    classSources.get(base)!.add(`${entryId} (${kind} ${text})`);
  };
  for (const line of load.lines) {
    const entryId = line.hmtRef.split("#")[0];
    const entry = ds.entries.find((e) => e.entryId === entryId);
    if (!entry) continue;
    noteClass(entry.hazardClass, entry.entryId, "class");
    for (const sub of entry.subsidiaryClasses ?? []) noteClass(sub, entry.entryId, "subsidiary");
  }
  const classes = new Set<string>(classSources.keys());
  const sourcesFor = (cls: string): string[] => [...(classSources.get(cls) ?? [])].sort();

  const gridLabels = new Set<string>();
  for (const c of ds.segregation) {
    gridLabels.add(c.rowClass);
    gridLabels.add(c.colClass);
  }
  const labelsFor = (cls: string): string[] => [...gridLabels].filter((l) => baseClass(l) === cls);

  const cellValue = (a: string, b: string): "X" | "O" | "*" | null => {
    const hit = ds.segregation.find((c) => (c.rowClass === a && c.colClass === b) || (c.rowClass === b && c.colClass === a));
    return hit ? hit.value : null;
  };

  const classList = [...classes];
  let restrictedPairs = 0;
  for (let i = 0; i < classList.length; i++) {
    for (let j = i + 1; j < classList.length; j++) {
      const a = classList[i] as string;
      const b = classList[j] as string;
      // most-severe applicable grid value across all label combinations (never under-restrict)
      let worst: "X" | "O" | "*" | null = null;
      for (const la of labelsFor(a)) {
        for (const lb of labelsFor(b)) {
          const v = cellValue(la, lb);
          if (v && (worst == null || SEVERITY[v]! > SEVERITY[worst]!)) worst = v;
        }
      }
      if (!worst) continue;
      restrictedPairs++;
      const cite = [{ cfr: "49 CFR 177.848(d)" }];
      if (worst === "X") {
        findings.push({
          ruleId: "segregation_prohibited",
          tier: "violation",
          message: `Class ${a} and class ${b} materials may NOT be loaded, transported, or stored together on the same vehicle (§177.848(d)).`,
          citations: cite,
          evidence: { classA: a, classB: b, value: "X", sourcesA: sourcesFor(a), sourcesB: sourcesFor(b) },
        });
      } else if (worst === "O") {
        findings.push({
          ruleId: "segregation_away_from",
          tier: "conditional",
          message: `Class ${a} and class ${b} materials must be segregated "Away From" each other — allowed only with the §177.848(d) separation maintained.`,
          citations: cite,
          evidence: { classA: a, classB: b, value: "O", sourcesA: sourcesFor(a), sourcesB: sourcesFor(b) },
        });
      } else {
        findings.push({
          ruleId: "segregation_special",
          tier: "conditional",
          message: `Class ${a} and class ${b} materials are subject to the specific segregation in §177.848 — review the applicable note before loading together.`,
          citations: cite,
          evidence: { classA: a, classB: b, value: "*", sourcesA: sourcesFor(a), sourcesB: sourcesFor(b) },
        });
      }
    }
  }

  if (restrictedPairs === 0) {
    findings.push({
      ruleId: "segregation_none",
      tier: "info",
      message:
        classList.length <= 1
          ? "Single hazard class on this load — no §177.848(d) segregation restriction applies."
          : `No §177.848(d) segregation restriction among the classes on this load (${classList.join(", ")}).`,
      citations: [{ cfr: "49 CFR 177.848(d)" }],
      evidence: { classes: classList },
    });
  }

  trace.push({
    ruleId: "segregation_check",
    fired: true,
    inputs: { classes: classList, restrictedPairs },
    citations: [{ cfr: "49 CFR 177.848(d)" }],
  });

  return { findings, trace, hasViolation: findings.some((f) => f.tier === "violation"), gridPresent: true };
}
