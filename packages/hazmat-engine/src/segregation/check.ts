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
 * @hazmat/data). A material is matched to the grid row its OWN facts name (qualifiers.ts, TWO-CLICK-READER-
 * PLAN TC1.1, D-TC8): "6.1 liquids PG I zone A" is the row of PG I zone-A liquids, not of every Division 6.1
 * material. Until 2026-10-29 every row sharing a class number counted and the most severe won, which made a
 * 3 + 6.1 PG III load a blocking violation the CFR does not impose (E1). Where a qualifier cannot be told from
 * the table, the most severe row the material might be on is reported as a `conditional`
 * (`segregation_unresolved`) naming the rows — never as a `violation`.
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
import { parseHmtRef } from "../hmtRef.js";
import { factsOf, labelMatches, type QualifierEntry } from "./qualifiers.js";

interface DsEntry extends QualifierEntry { entryId: string; hazardClass: string | null; subsidiaryClasses?: string[] }
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
      citations: [{ cfr: "49 CFR 177.848(d)" }],
      evidence: { cells: 0 },
    });
    return { findings, trace, hasViolation: false, gridPresent: false };
  }

  // Distinct hazard classes on the load, PRIMARY AND SUBSIDIARY, with a note of where each came
  // from. The provenance is not decoration: "Class 4.3 and Class 8 may not be loaded together" sends
  // a loader looking for a 4.3 placard that is not on the paperwork, whereas "Class 4.3 (subsidiary
  // risk of gas — UN1203) and Class 8" names the drum they are actually holding.
  const gridLabels = new Set<string>();
  for (const c of ds.segregation) for (const l of [c.rowClass, c.colClass]) if (typeof l === "string") gridLabels.add(l);

  // Per class on the load: where it came from, and each grid row a material of it is DEFINITELY on or MIGHT be on
  // (a qualifier the table cannot settle), with WHICH material — §177.848 keeps materials apart from each other, so
  // a material's primary hazard is never segregated from its own subsidiary one (acrolein, 6.1 with a subsidiary 3,
  // was a 3 × 6.1 violation on its own until 2026-10-29). A subsidiary hazard is read with its material's own row.
  type Placement = { label: string; material: string; sure: boolean };
  const classSources = new Map<string, Set<string>>();
  const placements = new Map<string, Placement[]>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
  const noteClass = (raw: string | null | undefined, entry: DsEntry, pg: string | null, kind: "class" | "subsidiary") => {
    const text = (raw ?? "").trim();
    if (!text) return;
    const base = baseClass(text);
    if (!base) return;
    add(classSources, base, `${entry.entryId} (${kind} ${text})`);
    const facts = factsOf(entry, base, pg);
    const material = `${entry.entryId}#${pg ?? "none"}`;
    for (const label of gridLabels) {
      if (baseClass(label) !== base) continue;
      const m = labelMatches(label, facts);
      if (m !== "no") (placements.get(base) ?? placements.set(base, []).get(base)!).push({ label, material, sure: m === "yes" });
    }
  };
  for (const line of load.lines) {
    const { entryId, pg } = parseHmtRef(line.hmtRef);
    const entry = ds.entries.find((e) => e.entryId === entryId);
    if (!entry) continue;
    noteClass(entry.hazardClass, entry, pg, "class");
    for (const sub of entry.subsidiaryClasses ?? []) noteClass(sub, entry, pg, "subsidiary");
  }
  const classes = new Set<string>(classSources.keys());
  const sourcesFor = (cls: string): string[] => [...(classSources.get(cls) ?? [])].sort();
  const placed = (cls: string, sureOnly: boolean): Placement[] => (placements.get(cls) ?? []).filter((p) => p.sure || !sureOnly);

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
      const worstOf = (sureOnly: boolean) => {
        let w: { value: "X" | "O" | "*"; rows: [string, string] } | null = null;
        for (const pa of placed(a, sureOnly)) for (const pb of placed(b, sureOnly)) {
          if (pa.material === pb.material) continue;
          const v = cellValue(pa.label, pb.label);
          if (v && (w == null || SEVERITY[v]! > SEVERITY[w.value]!)) w = { value: v, rows: [pa.label, pb.label] };
        }
        return w;
      };
      const worst = worstOf(true)?.value ?? null;
      const maybe = worstOf(false);
      const cite = [{ cfr: "49 CFR 177.848(d)" }];
      // A worse cell the load is only POSSIBLY on (a phase, zone or PG the table cannot settle) is a person's
      // question, not a violation: it names the two rows so the dispatcher can answer it from the paper.
      if (maybe && (worst === null || SEVERITY[maybe.value]! > SEVERITY[worst]!)) {
        restrictedPairs++;
        const rule = maybe.value === "X" ? "prohibits loading them together" : maybe.value === "O" ? "requires them kept away from each other" : "applies a specific segregation";
        findings.push({
          ruleId: "segregation_unresolved",
          tier: "conditional",
          message: `Class ${a} and class ${b}: if these materials are the table's "${maybe.rows[0]}" and "${maybe.rows[1]}" rows, §177.848(d) ${rule}. The Hazardous Materials Table does not say which row they are on — check the shipping paper.`,
          citations: cite,
          evidence: { classA: a, classB: b, value: maybe.value, rows: maybe.rows, sourcesA: sourcesFor(a), sourcesB: sourcesFor(b) },
        });
        continue;
      }
      if (!worst) continue;
      restrictedPairs++;
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
