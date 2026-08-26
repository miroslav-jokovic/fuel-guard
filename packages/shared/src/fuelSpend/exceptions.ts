/**
 * One ledger, many detectors — the shape every fuel finding takes (F6).
 *
 * ── WHY ONE OBJECT AND NOT ONE TABLE PER DETECTOR ────────────────────────────────────────────────
 * A reconciliation discrepancy, a fill billed above its contracted price, and a premium paid off the
 * preferred network are the SAME object: a priced, dated, attributable finding that somebody has to do
 * something about. Given a table each they get a status vocabulary each and a screen each, and the
 * product ends with six half-workflows and no answer to "what did we recover last quarter" — which is
 * the number that renews a contract.
 *
 * So: one `kind` discriminator, one lifecycle, one surface. A new detector is a new kind and a new
 * producer, never a new table.
 *
 * ── WHY NOT `anomalies`, WHICH ALREADY HAS THIS LIFECYCLE ────────────────────────────────────────
 * `anomalies.transaction_id` is `not null` and references `fuel_transactions`. The most valuable thing
 * the reconciler produces — a line the vendor billed that we have NO record of — has no
 * `fuel_transactions` row by definition. That is the whole point of the finding. `anomalies`
 * structurally cannot hold half the output, so the lifecycle COLUMNS are copied and the table is not
 * (D-FX2).
 *
 * ── THE FINGERPRINT IS THE WHOLE OF D-FX10 ───────────────────────────────────────────────────────
 * Re-running a reconciliation over a period must not reset a human's work. Every finding therefore
 * carries a deterministic fingerprint derived from WHAT IT IS rather than from which run found it, so
 * the same discrepancy found again is the same row: its evidence is refreshed, its status, owner and
 * note are left alone, and a finding that no longer appears is closed rather than deleted.
 *
 * The derivation is pure and lives here so the server and a test cannot disagree about it. It is a
 * readable joined string rather than a hash: a fingerprint that can be eyeballed in a database is
 * worth more during a dispute than one that saves forty bytes.
 */
import type { ContractCapture } from "./contractCapture.js";
import type { ReconResult, ReconRow } from "../reconcile/fuelMatch.js";

// ── the vocabulary ───────────────────────────────────────────────────────────────────────────────

export const FUEL_EXCEPTION_KINDS = [
  /** On the vendor's bill; no fill of ours matches it. The fuel-theft surface. */
  "recon_missing_in_system",
  /** Recorded by us; the vendor never billed it. Not recoverable — possibly not yet invoiced. */
  "recon_missing_on_report",
  "recon_amount",
  "recon_gallons",
  /** Billed above the price Pilot quoted for that station that day. */
  "contract_variance",
  /**
   * The three policy premiums. Present in the vocabulary from the start so the schema does not have to
   * change to admit them, and deliberately NOT produced yet — see `policyFindingsNote` below.
   */
  "off_network_premium",
  "avoided_state_premium",
  "avoided_brand_premium",
] as const;
export type FuelExceptionKind = (typeof FUEL_EXCEPTION_KINDS)[number];

/** The machine token and the words a reader sees ship as a pair. No `.vue` file carries a literal. */
export const FUEL_EXCEPTION_KIND_LABELS: Record<FuelExceptionKind, string> = {
  recon_missing_in_system: "Billed, never recorded",
  recon_missing_on_report: "Recorded, never billed",
  recon_amount: "Billed a different amount",
  recon_gallons: "Billed different gallons",
  contract_variance: "Billed above contract",
  off_network_premium: "Off the preferred network",
  avoided_state_premium: "Fuelled in an avoided state",
  avoided_brand_premium: "Fuelled at an avoided brand",
};

/**
 * The kinds `reconFindings` is authoritative for — its close scope, not merely its output (0253).
 *
 * `sync_fuel_exceptions` closes what a producer no longer finds in the period it just read, and it has
 * to be TOLD which kinds that producer owns. Deriving the set from the batch cannot work: a week whose
 * reconciliation produces no `recon_amount` rows is exactly the week that should close last week's, and
 * a set derived from an empty batch is empty. So the producer declares its territory here, beside the
 * function that produces it, and the caller passes this constant rather than a literal at the call site.
 *
 * A new detector adds a kind and its own constant. It never widens this one — a producer that closes
 * findings it did not produce retires somebody else's money.
 */
export const RECON_EXCEPTION_KINDS: readonly FuelExceptionKind[] = [
  "recon_missing_in_system",
  "recon_missing_on_report",
  "recon_amount",
  "recon_gallons",
];

export const FUEL_EXCEPTION_STATUSES = [
  "open",
  "investigating",
  "disputed",
  /** Settled in our favour — carries the amount actually credited, which is what E3 counts. */
  "credited",
  /** Looked at and judged not worth pursuing. A decision, and it is recorded as one. */
  "dismissed",
  /**
   * Closed because a later run over the same period no longer found it — a corrected statement, or a
   * fill that has since posted. Distinct from `dismissed`: nobody decided anything.
   */
  "resolved_by_reingest",
] as const;
export type FuelExceptionStatus = (typeof FUEL_EXCEPTION_STATUSES)[number];

export const FUEL_EXCEPTION_STATUS_LABELS: Record<FuelExceptionStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  disputed: "Disputed",
  credited: "Credited",
  dismissed: "Dismissed",
  resolved_by_reingest: "No longer found",
};

/** Which kind of money this is. Never summed across kinds — see D-FX5. */
export const FUEL_EXCEPTION_AMOUNT_KINDS = [
  "overbilled", "underbilled", "unbilled", "unrecorded", "premium", "opportunity",
] as const;
export type FuelExceptionAmountKind = (typeof FUEL_EXCEPTION_AMOUNT_KINDS)[number];

/** Statuses that still need somebody. The ledger's default filter, and E3's "identified" denominator. */
export const FUEL_EXCEPTION_OPEN_STATUSES: readonly FuelExceptionStatus[] = ["open", "investigating", "disputed"];

// ── the finding ──────────────────────────────────────────────────────────────────────────────────

export interface FuelExceptionFinding {
  kind: FuelExceptionKind;
  /** Stable across runs. See `fuelExceptionFingerprint`. */
  fingerprint: string;
  /** Station-local business date the finding is about. */
  occurredOn: string | null;
  /** Always a positive magnitude; `amountKind` says what it means. */
  amount: number;
  amountKind: FuelExceptionAmountKind;
  /** Our fill, when there is one. Null is the normal case for `recon_missing_in_system`. */
  transactionId: string | null;
  unit: string | null;
  driver: string | null;
  site: string | null;
  city: string | null;
  state: string | null;
  brand: string | null;
  /** Everything a reader needs to judge it without opening the source file. */
  evidence: Record<string, unknown>;
}

/**
 * A fingerprint identifies the FINDING, not the run that found it.
 *
 * Parts are normalised and joined with `|`. Anything null or empty becomes `-` so a missing part
 * cannot silently shift the others left and collide with a different finding.
 */
export function fuelExceptionFingerprint(
  kind: FuelExceptionKind,
  parts: readonly (string | number | null | undefined)[],
): string {
  const norm = (p: string | number | null | undefined): string => {
    if (p == null) return "-";
    const s = typeof p === "number" ? String(Math.round(p * 100) / 100) : p.trim().toLowerCase();
    return s === "" ? "-" : s.replace(/\|/g, "/");
  };
  return [kind, ...parts.map(norm)].join("|");
}

const r2 = (n: number) => Math.round(Math.abs(n) * 100) / 100;
const last6 = (s: string | null | undefined): string | null => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 6 ? d.slice(-6) : (d || null);
};

// ── the producers ────────────────────────────────────────────────────────────────────────────────

/**
 * Reconciliation rows → findings.
 *
 * Only the rows that need somebody. A `clean` row is not a finding, and neither is a `date_drift` or
 * `card_drift` one: those AGREE about the money and are merely labelled about how they were placed.
 * `amount_unknown` is excluded too — we cannot say a fill was mis-billed when we never recorded what
 * it cost, and filing it as a finding would put an unactionable row in front of somebody every week.
 *
 * The fingerprint keys on OUR transaction id wherever we have one, because that is the most stable
 * identifier in the system. For a line we never recorded there is no such id, so it keys on Pilot's
 * own authorisation number and product code, which are stable across re-parses of the same file.
 */
export function reconFindings(result: ReconResult): FuelExceptionFinding[] {
  const out: FuelExceptionFinding[] = [];
  for (const row of result.rows) {
    const f = toFinding(row);
    if (f) out.push(f);
  }
  return out;
}

function toFinding(row: ReconRow): FuelExceptionFinding | null {
  const rep = row.report;
  const sys = row.system;
  const base = {
    occurredOn: rep?.tranDate ?? sys?.tranDate ?? null,
    transactionId: sys?.id ?? null,
    unit: rep?.unit ?? sys?.unit ?? null,
    driver: null,
    site: rep?.site ?? null,
    city: rep?.city ?? null,
    state: rep?.state ?? null,
    brand: null,
  };

  if (row.status === "missing_in_system") {
    if (!rep) return null;
    return {
      ...base,
      kind: "recon_missing_in_system",
      fingerprint: fuelExceptionFingerprint("recon_missing_in_system", [
        rep.tranDate, rep.authNo, rep.productCode, last6(rep.cardRef), rep.gallons,
      ]),
      amount: r2(rep.netAmount ?? 0),
      amountKind: "unrecorded",
      evidence: {
        billedGallons: rep.gallons, billedAmount: rep.netAmount, authNo: rep.authNo,
        productCode: rep.productCode, card: last6(rep.cardRef), tank: row.tank,
      },
    };
  }

  if (row.status === "missing_on_report") {
    if (!sys) return null;
    return {
      ...base,
      kind: "recon_missing_on_report",
      // Our own row id: stable forever, and unique without any other part.
      fingerprint: fuelExceptionFingerprint("recon_missing_on_report", [sys.id]),
      amount: r2(sys.totalCost ?? 0),
      amountKind: "unbilled",
      evidence: {
        recordedGallons: sys.gallons, recordedAmount: sys.totalCost,
        card: last6(sys.cardRef), tank: row.tank,
      },
    };
  }

  if (row.status === "amount_mismatch" || row.status === "gallon_mismatch" || row.status === "other") {
    if (!sys || !rep) return null;
    const kind: FuelExceptionKind = row.status === "gallon_mismatch" ? "recon_gallons" : "recon_amount";
    const delta = row.amountDelta ?? 0;
    return {
      ...base,
      kind,
      fingerprint: fuelExceptionFingerprint(kind, [sys.id]),
      amount: r2(delta),
      // Positive delta means the vendor billed MORE than we recorded — the recoverable side.
      amountKind: delta >= 0 ? "overbilled" : "underbilled",
      evidence: {
        billedGallons: rep.gallons, recordedGallons: sys.gallons, gallonsDelta: row.gallonsDelta,
        billedAmount: rep.netAmount, recordedAmount: sys.totalCost, amountDelta: row.amountDelta,
        matchedOn: row.basis, authNo: rep.authNo, card: last6(rep.cardRef), note: row.note,
      },
    };
  }

  return null;
}

/**
 * Contract capture → findings, one per fill billed above its quoted price.
 *
 * Only the OVER side. A fill billed below contract is money in the carrier's favour and putting it on
 * a work queue would ask somebody to go and hand it back; `ContractCapture` already reports the under
 * figure beside the over one, which is where a reader should see it.
 *
 * `SpendLine` carries no row id, so the fingerprint is built from what identifies the fill on a
 * statement: its date, site, unit and gallons.
 *
 * ⚠ NOT WIRED. Nothing in `apps/api` calls this yet, so no `contract_variance` has ever been filed —
 * the tab computes the same figures for reading and none of them acquires a lifecycle. When it is
 * wired it must declare its OWN close-scope kind set the way `RECON_EXCEPTION_KINDS` does (0253); it
 * may not reuse that one, or a reconciliation with no contract quotes in range would close every
 * contract finding in its period as though it had looked and found nothing.
 */
export function contractFindings(capture: ContractCapture): FuelExceptionFinding[] {
  return capture.exceptions
    .filter((c) => c.variance > 0)
    .map((c) => ({
      kind: "contract_variance" as const,
      fingerprint: fuelExceptionFingerprint("contract_variance", [
        c.line.tranDate, c.line.site, c.line.unit, c.gallons,
      ]),
      occurredOn: c.line.tranDate,
      amount: r2(c.variance),
      amountKind: "overbilled" as const,
      transactionId: null,
      unit: c.line.unit,
      driver: c.line.driver,
      site: c.line.site,
      city: c.line.city,
      state: c.line.state,
      brand: c.line.brand,
      evidence: {
        gallons: c.gallons, paid: c.paid, expected: c.expected,
        paidPerGal: c.paidPerGal, contractPerGal: c.contractPerGal,
        variancePerGal: c.variancePerGal, quoteAgeDays: c.staleDays,
      },
    }));
}

/**
 * ── WHY THE POLICY PREMIUMS ARE NOT PRODUCED YET ─────────────────────────────────────────────────
 * `off_network_premium` and its two siblings are in the vocabulary so the schema does not need to
 * change to admit them, and no producer emits them. The reason is materiality, not effort: measured on
 * production, the default window holds **201 off-network fills**. Two hundred and one rows on a work
 * queue is not two hundred and one actions, and a ledger that opens with them buries the nineteen
 * fills actually billed over contract.
 *
 * They need either a threshold or an aggregation — per site, per month — and picking one is a product
 * decision that belongs with the surface (F6b) rather than guessed at here. Until then the exception
 * tabs price them fill by fill, which is the right shape for reading and the wrong shape for a queue.
 */
export const policyFindingsNote =
  "Policy premiums are reported on their tabs, not filed as exceptions — 201 off-network fills in a " +
  "90-day window is not 201 actions. F6b decides the threshold or the grouping.";
