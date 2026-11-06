import type { SupabaseClient } from "@supabase/supabase-js";
import { driverFirstLastKey, driverMatchKey, deriveFullName, type TmsDriverInput } from "@silvicom/shared";
import { recordHireFromTms } from "../recruiting/index.js";
import { handApplicationToTms } from "../roster/index.js";
import { cdlKey } from "./rosterMatch.js";

/**
 * A McLeod hire of somebody who applied through 360 (ROSTER-LIFECYCLE-PLAN D-RL5, owner 2026-11-06).
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────────────────────────
 * RL1 held a McLeod driver out of matching whenever an open application answered him, and the held list
 * told the office to "finish the hire in Hiring". That assumed the hire happens HERE. It does not: the
 * carrier hires in McLeod, and nobody presses Hire in 360. Curtis Hairston applied through 360 on 10-21,
 * McLeod hired him on 10-28, and on 11-06 he was still missing from Drivers, held for a click that was
 * never coming. Owner, 2026-11-06: "hiring is not done from 360".
 *
 * ── WHAT IT DOES NOW ────────────────────────────────────────────────────────────────────────────
 * McLeod's hire IS the hire. The application row becomes the driver (it already holds the application,
 * the consents and every screening filed against it, so no second row and nothing to move), and it goes
 * through `hire_applicant` — the one door 0386 leaves open from applicant to active, so the §391.23
 * records the Hire button would file are filed here too. Then the row is McLeod's, and the matcher links
 * and refreshes it in this same sweep.
 *
 * Q-HM5 still governs the 360 Hire button: that button refuses an unfinished file. This cannot refuse —
 * the person is already employed and may already be driving — so it RECORDS what the file still lacks on
 * the audit row (`openSteps`) and the DQ file shows the gaps, which is the honest state.
 *
 * ── WHY THE LICENCE ALONE IS NOT ENOUGH HERE ────────────────────────────────────────────────────────
 * A roster row's licence came from McLeod or Samsara; an application's was typed by the applicant. One
 * archived application carried ANOTHER driver's licence (`rosterIngest.settle.test.ts`, "Tatjana's").
 * So the name must agree as well — full name, or given name and surname when one side has a middle name.
 * A licence or a name alone stays held, for a person, with a message saying which.
 */

interface Row {
  id: string;
  status: string | null;
  archived_at: string | null;
  cdl_number: string | null;
  full_name: string | null;
  mcleod_driver_id: string | null;
}

export interface ApplicantHireResult {
  /** McLeod ids whose application row was hired (or, in report mode, would be). */
  hiredFromTms: string[];
}

const sameName = (a: string, b: string) =>
  (!!driverMatchKey(a) && driverMatchKey(a) === driverMatchKey(b)) ||
  (!!driverFirstLastKey(a) && driverFirstLastKey(a) === driverFirstLastKey(b));

export async function hireApplicantsFromTms(
  admin: SupabaseClient,
  orgId: string,
  rows: readonly TmsDriverInput[],
  write: boolean,
): Promise<ApplicantHireResult> {
  const out: ApplicantHireResult = { hiredFromTms: [] };
  const { data, error } = await admin
    .from("drivers")
    .select("id, status, archived_at, cdl_number, full_name, mcleod_driver_id")
    .eq("org_id", orgId)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  const all = (data ?? []) as Row[];

  // A roster row answering McLeod's id or licence wins outright: that person is already a driver here,
  // and the matcher links them. Only when NOTHING on the roster answers is an application the candidate.
  const live = new Set<string>();
  const applicants = new Map<string, Row | null>();
  for (const r of all) {
    const ck = cdlKey(r.cdl_number);
    if (r.status !== "applicant") {
      if (r.mcleod_driver_id) live.add(`id:${r.mcleod_driver_id}`);
      if (ck) live.add(`cdl:${ck}`);
    } else if (ck) {
      applicants.set(ck, applicants.has(ck) ? null : r);
    }
  }

  for (const r of rows) {
    // The agent reads `is_active = 'Y'` rows only; a status saying otherwise is no hire.
    if (r.status && r.status !== "active") continue;
    const ck = cdlKey(r.cdl_number);
    if (!ck || !r.hire_date) continue;
    if (live.has(`id:${r.external_id}`) || live.has(`cdl:${ck}`)) continue;
    const app = applicants.get(ck);
    if (!app) continue; // none, or two applications on one licence — never guessed between
    const name = deriveFullName({ first_name: r.first_name ?? null, middle_name: r.middle_name ?? null, last_name: r.last_name ?? null });
    if (!sameName(app.full_name ?? "", name)) continue;

    if (!write) {
      out.hiredFromTms.push(r.external_id);
      continue;
    }
    // The link FIRST, the hire second. Linked but not yet hired is a state the next sweep finishes (this
    // function runs again: an application is never `live`). Hired but not linked would be stuck — an
    // active row whose applicant-typed identity the matcher stands off from, never to be linked.
    const handed = await handApplicationToTms(admin, orgId, { driverId: app.id, externalId: r.external_id, companyId: r.company_id ?? null });
    if (!handed) continue; // 23505: McLeod's id is claimed elsewhere — left held, the matcher reports it
    const hired = await recordHireFromTms(admin, orgId, { driverId: app.id, externalId: r.external_id, hireDate: r.hire_date });
    if ("code" in hired) continue;
    out.hiredFromTms.push(r.external_id);
  }
  return out;
}
