import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsDriverInput } from "@silvicom/shared";
import { TMS_CLAIMABLE_SOURCES } from "@silvicom/shared";
import { restoreRehiredDriver } from "../roster/index.js";
import { cdlKey, type MatchOutcome } from "./rosterMatch.js";

/**
 * Two rules that decide whether a McLeod driver SETTLES onto one of our rows — the gaps the Seats card
 * audit found on 2026-10-14 (MCLEOD-ROSTER-SYNC-PLAN D-MR7a, D-MR16).
 *
 * ── 1. AN EFS ROW IS CLAIMED ON A LICENCE, NEVER ON A NAME ──────────────────────────────────────
 * `rosterIngest`'s header excluded `efs` rows from claiming because "they carry no licence, so they can
 * only ever be reached by the NAME fallback". True in August; not since a new hire's fuel card started
 * arriving before McLeod's record: measured 2026-10-14, all 11 active drivers hired 09-16..10-08 sat on
 * EFS rows with no McLeod link, McLeod first by 1–7 days. The Samsara sync now fills a licence on those
 * rows (enrich-only, D6), so McLeod meets them on the licence — the key the header trusts — and the
 * name-only case it was guarding against stays refused. A row already carrying McLeod's id (`link`) is
 * the same proof.
 *
 * ── 2. A REHIRE IS RECOGNISED, NOT REPORTED FOREVER ─────────────────────────────────────────────
 * D-MR7 made re-hire "a review item, not auto-reactivation", and nothing ever read the item: Youness
 * Alam was terminated and archived by the 2026-09-14 reconcile run, McLeod rehired him 09-30, and on
 * 10-13 he drove 809 all afternoon while our roster called him terminated — so no truck could seat him.
 * Owner ruled 2026-10-14 (D-MR7a): when McLeod reports a driver ACTIVE with a hire date AFTER the
 * termination date on our row, that is a rehire, proven by the carrier's own dates, and the sweep
 * restores the row. Anything weaker — no termination date to compare, a hire date on or before it, two
 * former rows answering, a row the office owns — stays a review item, as D-MR7 had it.
 *
 * The termination date is CLEARED on rehire and the old one kept in the audit row. D-MR7's "never
 * clear" protects the §391.51(c) retention clock, and here keeping the date is what would break it:
 * `rosterRetire` never moves a date that is already set, so the NEXT termination would keep 2026-09-14
 * and start the clock years early. A re-employed driver's file is retained through the new employment,
 * so clearing it only ever lengthens retention.
 */

const CLAIMABLE = new Set<string>(TMS_CLAIMABLE_SOURCES);

/** May McLeod write identity onto a row of this provenance, reached this way? */
export function mayClaimIdentity(source: string | null, outcome: MatchOutcome): boolean {
  if (CLAIMABLE.has(source ?? "")) return true;
  return source === "efs" && (outcome.kind === "linked" || (outcome.kind === "matched" && outcome.by === "cdl"));
}

/** Driver statuses a former employee holds. Applicants are the recruiting pipeline's, never former. */
const FORMER_STATUSES = new Set(["terminated", "inactive"]);

interface DriverRow {
  id: string;
  status: string | null;
  archived_at: string | null;
  termination_date: string | null;
  cdl_number: string | null;
  mcleod_driver_id: string | null;
  identity_source: string | null;
}

export interface RehireResult {
  /** McLeod ids whose former row was restored (or, in report mode, would be). */
  rehired: string[];
  /** McLeod ids that answer to a former row we will not restore on our own — for a human. */
  rehireReview: string[];
}

/**
 * Restore every former driver McLeod has rehired. Runs BEFORE the matcher loads its candidates, so a
 * restored row is in the pool the same sweep links and refreshes — one sweep, not two.
 *
 * Matched on McLeod's id or the licence only; a name is never enough to bring somebody back. A live row
 * answering the same key wins outright: that person is already on the roster.
 */
export async function rehireFormerDrivers(
  admin: SupabaseClient,
  orgId: string,
  rows: readonly TmsDriverInput[],
  write: boolean,
): Promise<RehireResult> {
  const out: RehireResult = { rehired: [], rehireReview: [] };
  const { data, error } = await admin
    .from("drivers")
    .select("id, status, archived_at, termination_date, cdl_number, mcleod_driver_id, identity_source")
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const all = ((data ?? []) as DriverRow[]).filter((r) => r.status !== "applicant");
  const isFormer = (r: DriverRow) => r.archived_at !== null || FORMER_STATUSES.has(r.status ?? "");

  const live = new Set<string>();
  const former = new Map<string, DriverRow | null>();
  for (const r of all) {
    for (const key of [r.mcleod_driver_id ? `id:${r.mcleod_driver_id}` : "", cdlKey(r.cdl_number) ? `cdl:${cdlKey(r.cdl_number)}` : ""]) {
      if (!key) continue;
      if (!isFormer(r)) live.add(key);
      else former.set(key, former.has(key) && former.get(key)?.id !== r.id ? null : r);
    }
  }

  for (const r of rows) {
    // The agent reads `is_active = 'Y'` rows only; a status saying otherwise is no rehire.
    if (r.status && r.status !== "active") continue;
    const keys = [`id:${r.external_id}`, cdlKey(r.cdl_number) ? `cdl:${cdlKey(r.cdl_number)}` : ""].filter(Boolean);
    if (keys.some((k) => live.has(k))) continue;
    const hits = keys.map((k) => former.get(k)).filter((h) => h !== undefined);
    if (hits.length === 0) continue;
    const row = hits.every((h) => h && h.id === hits[0]?.id) ? hits[0]! : null;
    const proven =
      row !== null && row.identity_source !== "manual" && !!row.termination_date && !!r.hire_date && r.hire_date > row.termination_date;
    if (!proven) {
      out.rehireReview.push(r.external_id);
      continue;
    }
    out.rehired.push(r.external_id);
    if (!write) continue;

    await restoreRehiredDriver(admin, orgId, {
      driverId: row.id,
      externalId: r.external_id,
      tmsHireDate: r.hire_date!,
      previousTerminationDate: row.termination_date!,
      previousStatus: row.status,
      wasArchived: row.archived_at !== null,
    });
  }
  return out;
}

/**
 * Fill `retry`: every external id this run could not settle, so the agent sends it again next sweep.
 *
 * The agent remembers a hash of every row it has sent and sends only changes (`diffAgainstState`). A row
 * the API could not place was remembered all the same, so it was never sent again: a driver McLeod hires
 * before our row exists — the normal order for a new hire, measured 2026-10-14 — stayed unlinked for
 * good, because by the time the row existed nothing about McLeod's record had changed. `retry` is the
 * API saying which rows it did not settle; the agent forgets their hash (roster.mjs `forgetUnsettled`).
 *
 * Unmatched, ambiguous and applicant outcomes all resolve when OUR side changes, so all three retry.
 * A row the office owns does not: that stand-off is the answer, and resending it would change nothing.
 */
export function withRetry<T extends { retry: string[]; unmatched: string[]; ambiguous: string[]; applicants: string[] }>(out: T): T {
  out.retry = [...new Set([...out.retry, ...out.unmatched, ...out.ambiguous, ...out.applicants])];
  return out;
}
