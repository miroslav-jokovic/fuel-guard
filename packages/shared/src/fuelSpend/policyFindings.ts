/**
 * The three policy premiums become findings — one per truck, per kind, per month (C6, Q-FUI3).
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────────────────────────
 * `fuel_exceptions` shipped in 0250 with eight kinds and, measured in production on 2026-09-05, ONE
 * row. Its only wired producer is `reconFindings`, which cannot fire until somebody uploads a vendor
 * statement, and `fuel_statements` is still empty after eight months. The policy detectors read the
 * EFS feed instead, of which this carrier has ~14,800 rows. So this is not an enhancement to a working
 * ledger; it is the step that gives the ledger its first rows.
 *
 * ── THE UNIT OF WORK IS A TRUCK, A KIND AND A MONTH (Q-FUI3, owner ruling 2026-09-05) ────────────
 * `policyFindingsNote` recorded the problem this replaces: the default window holds 201 off-network
 * fills, and 201 rows on a work queue is not 201 actions. The three candidates were per truck × kind ×
 * month, per kind × month fleet-wide, and per fill above a dollar threshold. The ruling is the first,
 * on the grounds that it matches the conversation a fleet manager actually has — "truck 412, off the
 * network, August" is something one person can open, judge and close. Fleet-wide-per-kind is a report
 * wearing a queue's clothes: nobody can close "the fleet fuelled off-network in August". Per-fill needs
 * a dollar threshold nobody has measured, and reproduces the 201 rows on a busy month anyway.
 *
 * **No dollar threshold is applied here.** The ruling rejected the framing that needs one, and the
 * gate that remains is not a guess: a group files when it cost the carrier money against the same
 * month's baseline, and does not when it did not.
 *
 * ── THE MONTH IS THE BASELINE'S UNIT TOO, WHICH IS WHY THIS REFUSES A PARTIAL ONE ────────────────
 * `exceptionReport` prices a premium against WHAT THE REST OF THE FLEET PAID OVER THE SAME LINES —
 * deliberately, because diesel moved 32% across the window these reports cover and a fixed baseline
 * makes every fill in a rising market look like an incident. That baseline is only the month's if the
 * input IS the month: hand it the trailing fortnight and August's finding is priced against two weeks
 * of August, which is a different number that would silently replace the first one on the next run.
 *
 * So `policyFindings` takes a month, filters the input to it, and derives everything inside. A caller
 * that reads a rolling window and passes it here gets the month's fills scored and the rest ignored,
 * rather than a plausible wrong answer.
 *
 * ── THE THREE KINDS OVERLAP BY CONSTRUCTION AND ARE NEVER SUMMED (D-FX5) ─────────────────────────
 * A ONE9 fill in California is off-brand, in an avoided state, and off the preferred network. It
 * therefore produces THREE findings, each carrying its full excess, and adding them triples the money.
 * This is the same trap `PolicyExceptions.offPolicy` documents for the reading surface, and it is
 * survivable here only because the ledger's own rule is that amounts are never summed across kinds.
 * A consumer that wants one number for "what did policy cost us" must read `offPolicy`, not this.
 *
 * ── THE MONEY HAS TO RECONCILE, SO THE RESIDUALS ARE RETURNED RATHER THAN DROPPED ────────────────
 * C6's Done-when is that a window showing an off-network premium on the old tab produces findings
 * totalling the same money. Two populations do not survive the grouping — fills carrying no unit
 * number, which cannot be placed on a truck, and truck-months that BEAT the baseline, which are not
 * findings. Both are real money in the tab's total. Returning them beside the findings is what lets a
 * caller state the identity instead of hoping it holds:
 *
 *     report.excess  ==  sum(findings.amount) + unattributedExcess + beneficialExcess
 *
 * `policyFindingsReconcile` asserts exactly that, and `policyFindings.test.ts` runs it over generated
 * fills so the identity is a property rather than a fixture.
 */
import { fuelExceptionFingerprint, type FuelExceptionFinding, type FuelExceptionKind } from "./exceptions.js";
import { analyzePolicyExceptions, type ExceptionFill, type ExceptionReport, type FuelPolicy, DEFAULT_FUEL_POLICY } from "./policyExceptions.js";
import { isTractorFuel, type SpendLine } from "./types.js";

/**
 * The kinds THIS producer is authoritative for — its close scope, not merely its output (0253).
 *
 * `sync_fuel_exceptions` closes what a producer no longer finds in the period it just read, and it has
 * to be told which kinds that producer owns. This constant may never be merged into
 * `RECON_EXCEPTION_KINDS` and that one may never be widened with these: a reconciliation that runs over
 * a week with no policy scan would otherwise close every policy finding in it as though it had looked.
 */
export const POLICY_EXCEPTION_KINDS: readonly PolicyExceptionKind[] = [
  "off_network_premium",
  "avoided_state_premium",
  "avoided_brand_premium",
];

/**
 * The policy half of the ledger's vocabulary, DERIVED from it rather than restated beside it.
 *
 * The point is the compile error: `KIND_SOURCE` below is a total `Record` over this union, so adding a
 * fourth premium kind to `FUEL_EXCEPTION_KINDS` fails the build here until somebody says which report
 * produces it. A hand-written union would have admitted the new kind silently and shipped a detector
 * that files nothing.
 */
export type PolicyExceptionKind = Extract<FuelExceptionKind, `${string}_premium`>;

/** Which `ExceptionReport` on `PolicyExceptions` each kind is produced from. Total by construction. */
const KIND_SOURCE: Record<PolicyExceptionKind, "offNetwork" | "avoidedStates" | "avoidedBrands"> = {
  off_network_premium: "offNetwork",
  avoided_state_premium: "avoidedStates",
  avoided_brand_premium: "avoidedBrands",
};

export interface PolicyFindingsResult {
  findings: FuelExceptionFinding[];
  /** Excess on fills carrying no unit number — real money, unplaceable on a truck. Per kind. */
  unattributed: Record<PolicyExceptionKind, { fills: number; excess: number }>;
  /** Excess on truck-months that beat the month's baseline. Not a finding; still in the tab's total. */
  beneficial: Record<PolicyExceptionKind, { groups: number; excess: number }>;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** `YYYY-MM` → the month's inclusive bounds. Calendar arithmetic, no clock, no timezone. */
export function monthBounds(month: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`policyFindings: month must be YYYY-MM, got ${JSON.stringify(month)}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error(`policyFindings: month ${month} is not a calendar month`);
  // Day 0 of the NEXT month is the last day of this one, and it is right across leap years without a
  // table. Built in UTC and read back as a date only, so a machine west of Greenwich cannot shift it.
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${month}-01`, end: `${month}-${pad(last)}` };
}

/** The fills of a month, tractor fuel only — the exact population every figure below is derived from. */
export function linesInMonth(lines: readonly SpendLine[], month: string): SpendLine[] {
  return lines.filter((l) => l.tranDate != null && l.tranDate.slice(0, 7) === month && isTractorFuel(l));
}

/** Unanimity or nothing: a facet is carried onto the finding only when every fill in it agrees. */
function unanimous(fills: readonly ExceptionFill[], pick: (l: SpendLine) => string | null): string | null {
  let seen: string | null = null;
  for (const f of fills) {
    const v = pick(f.line);
    if (v == null) return null;
    if (seen == null) seen = v;
    else if (seen !== v) return null;
  }
  return seen;
}

function distinct(fills: readonly ExceptionFill[], pick: (l: SpendLine) => string | null): string[] {
  const s = new Set<string>();
  for (const f of fills) {
    const v = pick(f.line);
    if (v != null && v !== "") s.add(v);
  }
  return [...s].sort();
}

function findingsForKind(
  kind: PolicyExceptionKind,
  report: ExceptionReport,
  month: string,
  bounds: { start: string; end: string },
): { findings: FuelExceptionFinding[]; unattributed: { fills: number; excess: number }; beneficial: { groups: number; excess: number } } {
  const byUnit = new Map<string, ExceptionFill[]>();
  let unattributedFills = 0;
  let unattributedExcess = 0;

  for (const f of report.fills) {
    const unit = f.line.unit?.trim();
    if (!unit) {
      unattributedFills += 1;
      unattributedExcess += f.excess;
      continue;
    }
    const b = byUnit.get(unit);
    if (b) b.push(f);
    else byUnit.set(unit, [f]);
  }

  const findings: FuelExceptionFinding[] = [];
  let beneficialGroups = 0;
  let beneficialExcess = 0;

  for (const [unit, fills] of byUnit) {
    const excess = r2(fills.reduce((a, f) => a + f.excess, 0));
    if (excess <= 0) {
      beneficialGroups += 1;
      beneficialExcess += excess;
      continue;
    }
    const gallons = fills.reduce((a, f) => a + f.line.gallons, 0);
    const spend = fills.reduce((a, f) => a + (f.line.netAmount ?? 0), 0);
    const dates = fills.map((f) => f.line.tranDate!).sort();

    findings.push({
      kind,
      // The grouping key IS the fingerprint's parts, so a second run over the same month produces the
      // same row: its evidence is refreshed and its status, owner and note are left alone (D-FX10).
      // `kind` is already the fingerprint's first element, so it is not repeated here.
      fingerprint: fuelExceptionFingerprint(kind, [month, unit]),
      /*
       * ── THE FINDING IS ABOUT A MONTH, NOT A MOMENT ──────────────────────────────────────────────
       * `occurred_on` holds the month's FIRST day so the ledger's period filters place the finding in
       * the month it is about, and — the load-bearing half — so `sync_fuel_exceptions` can close it by
       * period: a run over August passes August's bounds, and every August finding it no longer
       * produces falls inside them. Setting this to the last fill's date instead would move it every
       * time a late EFS row posted, which is a fingerprint's job to prevent and not a date's to
       * introduce. The fills' real span is in the evidence, where a reader needs it.
       */
      occurredOn: bounds.start,
      amount: excess,
      amountKind: "premium",
      // A month of a truck's fuel is not one transaction, and pointing at any single fill would make
      // the evidence drawer show one row of many as though it were the finding.
      transactionId: null,
      unit,
      // The RPC has no column for a driver NAME — `fuel_exceptions.driver_id` is a uuid FK and
      // `SpendLine.driver` is the vendor's P.O. text — so setting this would write a value the writer
      // discards. The names go in the evidence, where they survive.
      driver: null,
      // Carried only when every fill agrees. A truck that crossed two avoided states in a month has no
      // single state, and picking the first one would put a fact on the row that is not true of it.
      site: unanimous(fills, (l) => l.site),
      city: unanimous(fills, (l) => l.city),
      state: unanimous(fills, (l) => l.state),
      brand: unanimous(fills, (l) => l.brand),
      evidence: {
        month,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        fills: fills.length,
        gallons: r2(gallons),
        spend: r2(spend),
        netPerGal: gallons > 0 ? Math.round((spend / gallons) * 1000) / 1000 : null,
        // What the rest of the fleet's tractor fuel cost over the same month — the number `excess` is
        // measured against. Without it the dollar figure cannot be checked by the person it is shown to.
        baselinePerGal: report.baselinePerGal == null ? null : Math.round(report.baselinePerGal * 1000) / 1000,
        premiumPerGal: gallons > 0 ? Math.round((excess / gallons) * 1000) / 1000 : null,
        firstFill: dates[0] ?? null,
        lastFill: dates[dates.length - 1] ?? null,
        sites: distinct(fills, (l) => (l.site ? `${l.site} ${l.city ?? ""} ${l.state ?? ""}`.trim() : (l.city ?? null))),
        states: distinct(fills, (l) => l.state),
        brands: distinct(fills, (l) => l.brand),
        drivers: distinct(fills, (l) => l.driver),
      },
    });
  }

  findings.sort((a, b) => b.amount - a.amount || a.fingerprint.localeCompare(b.fingerprint));
  return {
    findings,
    unattributed: { fills: unattributedFills, excess: r2(unattributedExcess) },
    beneficial: { groups: beneficialGroups, excess: r2(beneficialExcess) },
  };
}

/**
 * Score one calendar month of fuel against the org's policy and return the findings it files.
 *
 * `lines` may be a superset — anything outside `month`, and anything that is not tractor fuel, is
 * filtered out before a single figure is derived. See the header for why that filter is the point
 * rather than a convenience.
 */
export function policyFindings(
  lines: readonly SpendLine[],
  month: string,
  policy: FuelPolicy = DEFAULT_FUEL_POLICY,
): PolicyFindingsResult {
  const bounds = monthBounds(month);
  const scoped = linesInMonth(lines, month);
  const reports = analyzePolicyExceptions(scoped, policy);

  const findings: FuelExceptionFinding[] = [];
  const unattributed = {} as PolicyFindingsResult["unattributed"];
  const beneficial = {} as PolicyFindingsResult["beneficial"];

  for (const kind of POLICY_EXCEPTION_KINDS) {
    const r = findingsForKind(kind, reports[KIND_SOURCE[kind]], month, bounds);
    findings.push(...r.findings);
    unattributed[kind] = r.unattributed;
    beneficial[kind] = r.beneficial;
  }

  return { findings, unattributed, beneficial };
}

/**
 * The reconciliation C6's Done-when asks for, computed rather than asserted in prose.
 *
 * For each kind: what the reading surface reports as that kind's excess, against what the ledger now
 * holds for it plus the two populations the grouping cannot file. `withinTolerance` allows a cent per
 * group for the rounding each stage does at two decimals; anything wider is a real divergence and the
 * caller should say so rather than publish two numbers.
 */
export function policyFindingsReconcile(
  lines: readonly SpendLine[],
  month: string,
  policy: FuelPolicy = DEFAULT_FUEL_POLICY,
): { kind: PolicyExceptionKind; reported: number; filed: number; unattributed: number; beneficial: number; delta: number; withinTolerance: boolean }[] {
  const scoped = linesInMonth(lines, month);
  const reports = analyzePolicyExceptions(scoped, policy);
  const res = policyFindings(lines, month, policy);
  return POLICY_EXCEPTION_KINDS.map((kind) => {
    const reported = reports[KIND_SOURCE[kind]].excess;
    const mine = res.findings.filter((f) => f.kind === kind);
    const filed = r2(mine.reduce((a, f) => a + f.amount, 0));
    const unattributed = res.unattributed[kind].excess;
    const beneficial = res.beneficial[kind].excess;
    const delta = r2(reported - (filed + unattributed + beneficial));
    return {
      kind,
      reported,
      filed,
      unattributed,
      beneficial,
      delta,
      withinTolerance: Math.abs(delta) <= 0.01 * Math.max(1, mine.length + res.beneficial[kind].groups),
    };
  });
}
