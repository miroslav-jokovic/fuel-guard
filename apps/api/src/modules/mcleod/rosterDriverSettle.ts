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
 *
 * ── 2a. McLEOD TAKING BACK ITS OWN TERMINATION (D-RL6, owner 2026-11-06) ───────────────────────────
 * The date rule missed the commonest rehire: McLeod un-terminating a driver without a new hire date.
 * Amable Rafael Nin Diaz: McLeod terminated him 10-28 and the 10-30 retire run copied that here; by
 * 11-04 McLeod had cleared the termination and listed him active again, hire date still 2024-04-29. The
 * held list told the office to "unarchive" a row that was never archived, and he stayed terminated.
 *
 * When McLeod reports the driver active with NO termination date, and nobody here ever terminated or
 * archived the row (no office `driver.updated` touching status or termination date, no `driver.archived`
 * by a person), the termination on our row can only have come from McLeod — the retire and reconcile
 * runs are its only other writers. McLeod has taken it back, and so does the sweep. A row the office
 * terminated or archived itself stays a review item: that is D-MR7's case, a decision made HERE that
 * McLeod has not caught up with.
 *
 * ── 2b. A ROW THE CLEANUP ARCHIVED WITHOUT A DATE (D-RL9, owner 2026-11-09) ─────────────────────────
 * Rule 2 compares McLeod's hire date with OUR termination date, and the 2026-09-14 reconcile run
 * archived 120 rows without writing one. Such a row could never be proven, whatever McLeod said.
 * Christopher Weaver (WCHRISTO): archived 09-14, rehired in McLeod 11-03, driving and fuelling every day
 * since, and on 11-06 the manual "Reconcile duplicates" folded his new row into the archived one (the
 * D-RL8 bug). From then on he was "worked here before" on the held list, every sweep, for good.
 *
 * So when the row carries no termination date, the day it was archived stands in for it, under the same
 * rule: McLeod's hire date strictly after it is a rehire. Narrower than rule 2 in two ways, because an
 * archive is a weaker fact than a termination: McLeod must send no termination date of its own, and no
 * person here may have archived or terminated the row (`officeEndedEmployment`) — a member's archive is
 * often duplicate cleanup, not a departure, and that stays a decision for a person. The archive day is
 * read in UTC; a hire on that same day is not "after" it, which can only hold somebody back, never
 * bring somebody back early.
 *
 * ── 3. McLEOD ENDED THE DRIVER BUT STILL LISTS THEM ACTIVE (D-RL10, owner 2026-11-09) ──────────────
 * Kenneth Satterwhite (KSATTERW): on 11-06 McLeod listed him `is_active = 'Y'` with a termination date
 * of 11-07 and his 2025 hire date; on 11-09 it still did, and he had not logged an hour or bought fuel
 * since 11-06. He had left. The held list told the office he "worked here before" and to set him back
 * to Active — the one step that would have put a driver who left back on the roster.
 *
 * A McLeod record carrying a termination date on or after its hire date says the employment ended or is
 * ending, whatever the active flag says. That is never a rehire, so it is held under its own reason,
 * `ended_in_mcleod`, which tells the office to finish the departure IN McLeod (or clear the date there if
 * the driver is staying — then rule 2a restores the row). Our row is not touched. A termination date
 * BEFORE the hire date is an old employment McLeod never cleared, and the rules above still decide it.
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
  /** McLeod ids listed active with a termination date on or after the hire date (D-RL10) — never a rehire. */
  endedInTms: string[];
}

/** A driver the rehire step held for a person or for McLeod: never created beside its former row. */
export function heldBack(out: Partial<Pick<RehireResult, "rehireReview" | "endedInTms">>, id: string): boolean {
  return !!(out.rehireReview?.includes(id) || out.endedInTms?.includes(id));
}

/** McLeod's record says the employment ended or is ending, whatever its active flag says (D-RL10). */
export function endedInTms(r: Pick<TmsDriverInput, "hire_date" | "termination_date">): boolean {
  return !!r.termination_date && (!r.hire_date || r.termination_date >= r.hire_date);
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
  const out: RehireResult = { rehired: [], rehireReview: [], endedInTms: [] };
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
    if (endedInTms(r)) {
      out.endedInTms.push(r.external_id);
      continue;
    }
    const owned = !row || row.identity_source === "manual";
    const terminatedOn = owned ? null : row.termination_date;
    // D-RL9: no termination date on the row, so the archive day stands in for it (rule 2b).
    const archivedOn = owned || terminatedOn || !row.archived_at ? null : row.archived_at.slice(0, 10);
    const endedOn = terminatedOn ?? archivedOn;
    const datesProve = !!endedOn && !!r.hire_date && r.hire_date > endedOn;
    // `=== null`, not falsy: an agent that does not send the field says nothing about it.
    const reversed =
      !!row && !!terminatedOn && !datesProve && r.termination_date === null && !(await officeEndedEmployment(admin, orgId, row.id));
    const archiveProves =
      !!row && !!archivedOn && datesProve && r.termination_date === null && !(await officeEndedEmployment(admin, orgId, row.id));
    if (!row || !endedOn || (terminatedOn ? !datesProve && !reversed : !archiveProves)) {
      out.rehireReview.push(r.external_id);
      continue;
    }
    out.rehired.push(r.external_id);
    if (!write) continue;

    await restoreRehiredDriver(admin, orgId, {
      driverId: row.id,
      externalId: r.external_id,
      tmsHireDate: r.hire_date ?? null,
      previousTerminationDate: terminatedOn,
      previousArchivedAt: row.archived_at,
      proof: !terminatedOn ? "hire_after_archive" : datesProve ? "hire_after_termination" : "tms_termination_reversed",
      previousStatus: row.status,
      wasArchived: row.archived_at !== null,
    });
  }
  return out;
}

/**
 * Did a PERSON here end this driver's employment? Read from the audit log the office's own acts write —
 * the roster PATCH (`driver.updated`, with the fields it was sent) and an archive by a member — rather
 * than restated as a flag on the row, which nothing would keep true. Asked only for a former row McLeod
 * lists as active, so a handful of reads a sweep at most.
 */
async function officeEndedEmployment(admin: SupabaseClient, orgId: string, driverId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("audit_logs")
    .select("action, actor_id, meta")
    .eq("org_id", orgId)
    .eq("entity", "drivers")
    .eq("entity_id", driverId)
    .in("action", ["driver.updated", "driver.archived"]);
  // Unknown is answered as yes: a failed read must never bring somebody back.
  if (error) return true;
  return ((data ?? []) as Array<{ action: string; actor_id: string | null; meta: { fields?: unknown } | null }>).some((a) =>
    a.action === "driver.archived"
      ? a.actor_id !== null
      : Array.isArray(a.meta?.fields) && (a.meta.fields.includes("status") || a.meta.fields.includes("termination_date")),
  );
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
