/**
 * Reconcile a vendor fuel report against the org's own fills, and RECORD what was concluded.
 *
 * ── THE BROWSER DECODES; THE SERVER CONCLUDES (D-FX1) ───────────────────────────────────────────
 * Only the browser has `pdfjs` and ExcelJS, so it turns a PDF into positioned words and a workbook
 * into a cell grid. It sends those. Everything that decides MEANING happens here: the parse, the
 * tie-out gate, the read of our own fills, and the match. A client can hand over bytes; it cannot hand
 * over a finding. `fuel_recon_runs` has no client write policy at all, so this is not merely the
 * intended path — it is the only one.
 *
 * Same shape as `ingestFuelStatement` (WP4), for the same reason and with the same refusal: a file
 * that cannot reproduce its own printed totals is rejected rather than reconciled.
 *
 * ── THE EXPORT IS GATED NOW TOO (L8) ────────────────────────────────────────────────────────────
 * The weekly statement has always been refused unless the parse reproduces the totals Pilot prints on
 * it. The monthly export had no check at all, and it is the format that produces the LARGER
 * reconciliation — five statements cover five weeks, one export covers two months. Its workbook turns
 * out to carry a `PivotTable` sheet whose Grand Total prints `Sum of Quantity`, which nothing had ever
 * read: verified on the real 2026-06/07 export, parsed 418,537.23 against printed 418,537.23.
 *
 * ── THE SERVICE ROLE BYPASSES RLS ───────────────────────────────────────────────────────────────
 * Every read below carries its own `.eq("org_id", …)`. That filter is the only tenant boundary this
 * code has, which is what `expectOrgScoped` asserts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_TOLERANCES,
  parsePilotFuelReport,
  parsePilotStatement,
  pilotExportTieOut,
  readPivotGrandTotalGallons,
  reconcileFuelReport,
  reconFindings,
  RECON_EXCEPTION_KINDS,
  stateTimeZone,
  type PilotReportFill,
  type ReconResult,
  type StatementWord,
  type SystemFill,
} from "@silvicom/shared";
import { createHash } from "node:crypto";
import { eachPage } from "../../lib/paging.js";

/**
 * Bumped whenever the matcher's behaviour changes, so two runs are only comparable when it matches.
 * `f4` is the rewrite that moved the card key to six digits, made assignment order-independent, and
 * split a day of drift out of the missing/missing pair.
 */
export const MATCHER_VERSION = "f4";

/** How many days either side a drifted match may sit. One, deliberately not two (D-FX4). */
const MAX_DAY_DRIFT = 1;

export interface ReconRunInput {
  /** Positioned words from a decoded PDF statement. */
  words?: StatementWord[] | null;
  /** The `All Transactions` sheet of a decoded monthly export. */
  grid?: unknown[][] | null;
  /** Its `PivotTable` sheet, which carries the printed total the tie-out gate needs. */
  pivotGrid?: unknown[][] | null;
  filename?: string | null;
  /** Set when this report was also kept as a statement, so the run points at its evidence. */
  statementId?: string | null;
}

export interface ReconRunResult {
  ok: boolean;
  error?: string;
  /** Verbatim from the gate, so the person holding the file is told which number disagreed. */
  tieOutFailures?: string[];
  runId?: string;
  periodStart?: string;
  periodEnd?: string;
  invoiceNo?: string | null;
  tieOutGated?: boolean;
  tieOutNotes?: string[];
  /** How many findings were filed to the ledger. Zero when the sync failed — see `exceptionError`. */
  filedExceptions?: number;
  exceptionError?: string | null;
  /** The full result, so the tab can render what was just recorded without a second round trip. */
  result?: ReconResult;
}

/** Station-local business date — the vendor bills on it, and `fueled_at` is an instant. */
function localBusinessDate(iso: string | null, state: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: stateTimeZone(state) ?? "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface ParsedReport {
  kind: "weekly_statement" | "monthly_export";
  lines: PilotReportFill[];
  unmatchableCount: number;
  startDate: string | null;
  endDate: string | null;
  invoiceNo: string | null;
  gated: boolean;
  failures: string[];
  notes: string[];
}

/** Re-parse and gate. Returns the refusal rather than throwing, so the route can answer with reasons. */
function parseAndGate(input: ReconRunInput): ParsedReport | { error: string; failures: string[] } {
  if (Array.isArray(input.words) && input.words.length > 0) {
    const p = parsePilotStatement(input.words);
    if (!p.headerFound) return { error: "That PDF isn't a Pilot statement — no transaction table was found.", failures: [] };
    if (!p.tieOut.ok) return { error: "The statement didn't add up.", failures: p.tieOut.failures };
    return {
      kind: "weekly_statement",
      // Every fuel line, both tanks. DEF and merchandise go too — the matcher sets them aside itself
      // rather than scoring them as fuel we failed to record.
      lines: [...p.fills, ...p.reeferLines, ...p.defLines],
      unmatchableCount: p.defLines.length + p.merchandise.length,
      startDate: p.startDate, endDate: p.endDate, invoiceNo: p.invoiceNumber,
      gated: true, failures: [], notes: p.tieOut.notes,
    };
  }

  if (Array.isArray(input.grid) && input.grid.length > 0) {
    const p = parsePilotFuelReport(input.grid as never);
    if (!p.headerFound) {
      return { error: "That file isn't a Pilot “All Transactions” export — no Authorization_No / Card_No / Quantity header was found.", failures: [] };
    }
    const tie = pilotExportTieOut({
      parsedDieselGallons: p.totalDieselGallons,
      printedDieselGallons: readPivotGrandTotalGallons(input.pivotGrid as never),
      skipped: p.skipped,
      unknownProducts: p.unknownProducts,
    });
    if (!tie.ok) return { error: "The export didn't add up.", failures: tie.failures };
    return {
      kind: "monthly_export",
      lines: [...p.fills, ...p.reeferLines, ...p.defLines],
      unmatchableCount: p.defLines.length + p.other.length,
      startDate: p.startDate, endDate: p.endDate, invoiceNo: null,
      gated: tie.gated, failures: [], notes: tie.notes,
    };
  }

  return { error: "Expected either { words } from a decoded PDF or { grid } from a decoded export.", failures: [] };
}

/**
 * The org's recorded fills over the report's window, BOTH tanks.
 *
 * Widened a day each side on the instant, because a station-local business date can sit either side of
 * its UTC instant; the matcher filters on the business date afterwards.
 */
async function readSystemFills(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<SystemFill[]> {
  // Unit numbers first, so a rendered row can name a truck rather than a uuid. `vehicle_id` is the
  // link; `control_id` is the DRIVER's card control and would resolve nothing.
  const { data: vehicles } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId);
  const unitOf = new Map(
    (vehicles ?? []).map((v) => [String((v as { id: string }).id), (v as { unit_number: string | null }).unit_number]),
  );

  const out: SystemFill[] = [];
  await eachPage<Record<string, unknown>>(
    (lo, hi) =>
      admin
        .from("fuel_transactions")
        .select("id, card_ref, control_id, vehicle_id, fueled_at, gallons, total_cost, state, tank_type")
        .eq("org_id", orgId)
        .gte("fueled_at", `${addDays(from, -1)}T00:00:00.000Z`)
        .lte("fueled_at", `${addDays(to, 1)}T23:59:59.999Z`)
        .order("fueled_at", { ascending: true })
        .range(lo, hi),
    (rows) => {
      for (const raw of rows) {
        const vehicleId = raw.vehicle_id == null ? null : String(raw.vehicle_id);
        out.push({
          id: String(raw.id),
          cardRef: raw.card_ref == null ? null : String(raw.card_ref),
          controlId: raw.control_id == null ? null : String(raw.control_id),
          unit: vehicleId ? (unitOf.get(vehicleId) ?? null) : null,
          fueledAt: raw.fueled_at == null ? null : String(raw.fueled_at),
          tranDate: localBusinessDate(
            raw.fueled_at == null ? null : String(raw.fueled_at),
            raw.state == null ? null : String(raw.state),
          ),
          tank: raw.tank_type === "reefer" ? "reefer" : "tractor",
          gallons: raw.gallons == null ? 0 : Number(raw.gallons),
          totalCost: raw.total_cost == null ? null : Number(raw.total_cost),
        });
      }
    },
  );
  return out;
}

export async function runFuelReconciliation(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
  input: ReconRunInput,
): Promise<ReconRunResult> {
  const parsed = parseAndGate(input);
  if ("error" in parsed) return { ok: false, error: parsed.error, tieOutFailures: parsed.failures };
  if (!parsed.startDate || !parsed.endDate) {
    return { ok: false, error: "The report does not state the period it covers, so there is nothing to reconcile it against." };
  }

  const system = await readSystemFills(admin, orgId, parsed.startDate, parsed.endDate);

  const result = reconcileFuelReport(parsed.lines, system, {
    tolerances: DEFAULT_TOLERANCES,
    window: { from: parsed.startDate, to: parsed.endDate },
    maxDayDrift: MAX_DAY_DRIFT,
  });

  // The bytes are not stored here — a statement's PDF is already kept by `fuel_statements` (0243), and
  // an export is not a billing record. The hash is, so the same file is recognisable on re-upload.
  const sha = createHash("sha256")
    .update(JSON.stringify(input.words ?? input.grid ?? []))
    .digest("hex");

  const { data, error } = await admin
    .from("fuel_recon_runs")
    .insert({
      org_id: orgId,
      source_kind: parsed.kind,
      statement_id: input.statementId ?? null,
      source_filename: input.filename ?? null,
      source_sha256: sha,
      invoice_no: parsed.invoiceNo,
      period_start: parsed.startDate,
      period_end: parsed.endDate,
      tie_out_gated: parsed.gated,
      tie_out_notes: parsed.notes,
      tol_gallons: DEFAULT_TOLERANCES.gallons,
      tol_amount_abs: DEFAULT_TOLERANCES.amountAbs,
      tol_amount_pct: DEFAULT_TOLERANCES.amountPct,
      max_day_drift: MAX_DAY_DRIFT,
      matcher_version: MATCHER_VERSION,
      summary: result.summary,
      unmatchable_lines: result.unmatchable.length,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not record the reconciliation." };

  const runId = String((data as { id: string }).id);

  /*
   * File the findings (F6a). Set-based, through `sync_fuel_exceptions`, which refreshes evidence and
   * NEVER touches `status`, `assigned_to` or `resolution_note` — re-reconciling a period must not
   * reset what somebody decided about it last week (D-FX10). A finding this run no longer produces is
   * closed as `resolved_by_reingest` rather than deleted, because "nobody decided anything, it stopped
   * appearing" is a different fact from "somebody dismissed it".
   *
   * Best-effort on purpose: the run is already recorded and the reader is already looking at it, so a
   * failure here costs the ledger an entry rather than costing them the reconciliation.
   */
  const findings = reconFindings(result);
  const { error: syncErr } = await admin.rpc("sync_fuel_exceptions", {
    p_org: orgId,
    p_run: runId,
    p_findings: findings,
    p_actor: actorId,
    // The kinds THIS producer is authoritative for, so the RPC can close what it no longer finds in
    // the period this run read (0253). Before that migration the close was scoped by `run_id`, which
    // the upsert had just rewritten to this very run — so nothing could ever close, and a discrepancy
    // a corrected statement resolved sat open on the queue for good. Declared in shared beside
    // `reconFindings` rather than written out here: a literal at a call site is how a producer ends up
    // closing findings it does not own.
    p_kinds: RECON_EXCEPTION_KINDS,
  });

  return {
    ok: true,
    runId,
    filedExceptions: syncErr ? 0 : findings.length,
    exceptionError: syncErr?.message ?? null,
    periodStart: parsed.startDate,
    periodEnd: parsed.endDate,
    invoiceNo: parsed.invoiceNo,
    tieOutGated: parsed.gated,
    tieOutNotes: parsed.notes,
    result,
  };
}
