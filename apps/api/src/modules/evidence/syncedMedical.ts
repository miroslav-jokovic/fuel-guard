import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  MEDICAL_SOURCES,
  resolveMedicalExpiry,
  type MedicalCardState,
  type MedicalSource,
  type MedicalSourceDate,
} from "@silvicom/shared";
import { insertCertification } from "./compliance.js";

/**
 * The medical card, filed from more than one outside source (MEDSTOP-PLAN.md §7A.10, D-MSUX4a;
 * Q-MSUX7 answered 2026-10-13).
 *
 * McLeod's roster sweep (nightly, per driver, through `recordSyncedCredentials`) and Med-Stop's
 * (hourly, the whole roster, through `recordMedicalSourceDates`) each REPORT what their source says
 * — recorded per source in `credential_source_dates` (0467) — and the card on file is then whatever
 * `resolveMedicalExpiry` says over the scanned card and every source's latest claim. The point of the
 * shape: both sweeps compute the same answer from the same rows, so neither ever files a date the
 * other will move back. Filed straight from each sweep, two disagreeing sources would supersede each
 * other ~24 times a day per driver in a table nothing is allowed to prune.
 *
 * Write-only-on-change at BOTH levels: a claim is recorded only when it moved, and a certification is
 * filed only when the resolved date differs from the one on file — so a steady roster writes nothing.
 *
 * Fail closed: a claim that could not be recorded files nothing. Filing anyway would resolve over a
 * claim set the next sweep will not see, which is exactly the disagreement this exists to prevent.
 */

/**
 * Stamped on every synced row — the marker DRIVER-ROSTER-PLAN §6 Q6's `documented` fix finds these by.
 * McLeod's text predates this file and is kept byte-for-byte (0467's backfill matches on it).
 */
export const SYNC_NOTES: Record<MedicalSource, string> = {
  mcleod: "Recorded from the carrier's TMS (McLeod) roster sync — no scan filed by the sync.",
  medstop: "Recorded from Med-Stop's roster (medical expiry) — no scan filed by the sync.",
};

export type MedicalFiling = "written" | "unchanged" | { error: string };

const day = (d: string | null | undefined): string | null => (d ? d.slice(0, 10) : null);

/** The current card row for one driver, as the two readers below select it. */
export interface CurrentMedicalRow {
  expires_at: string | null;
  document_id: string | null;
}

export function medicalStateOf(card: CurrentMedicalRow | undefined, claims: MedicalSourceDate[]): MedicalCardState {
  return {
    onFile: card ? { expiresOn: day(card.expires_at), documented: card.document_id !== null } : null,
    claims,
  };
}

/** Read one driver's claims. Used by the per-driver McLeod path; the batch path pages the whole org. */
export async function readDriverClaims(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<MedicalSourceDate[] | { error: string }> {
  const { data, error } = await admin
    .from("credential_source_dates")
    .select("source, expires_on")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("kind", "medical_card");
  if (error) return { error: error.message };
  return toClaims(data ?? []);
}

function toClaims(rows: Array<{ source?: unknown; expires_on?: unknown }>): MedicalSourceDate[] {
  return rows
    .filter((r) => (MEDICAL_SOURCES as readonly unknown[]).includes(r.source))
    .map((r) => ({ source: r.source as MedicalSource, expiresOn: day(r.expires_on as string)! }));
}

/** One driver: record `source`'s claim if it moved, then file what the rule says if the file differs. */
export async function fileMedicalClaim(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  source: MedicalSource,
  claimed: string,
  state: MedicalCardState,
): Promise<MedicalFiling> {
  const claimDay = day(claimed)!;
  const prior = state.claims.find((c) => c.source === source);
  if (prior?.expiresOn !== claimDay) {
    const { error } = await admin.rpc("record_credential_source_date", {
      p_org: orgId, p_driver: driverId, p_kind: "medical_card", p_source: source, p_expires_on: claimDay,
    });
    if (error) return { error: error.message };
  }
  const claims = [...state.claims.filter((c) => c.source !== source), { source, expiresOn: claimDay }];
  const resolved = resolveMedicalExpiry(state.onFile, claims);
  if (!resolved.expiresOn || resolved.expiresOn === state.onFile?.expiresOn) return "unchanged";

  // The note names a source that actually gave the filed date; McLeod's when both did, so a row the
  // sweep would have filed before Med-Stop existed reads exactly as it always has.
  const givers = claims.filter((c) => c.expiresOn === resolved.expiresOn).map((c) => c.source);
  const res = await insertCertification(admin, orgId, null, {
    id: randomUUID(),
    subjectType: "driver",
    subjectId: driverId,
    kind: "medical_card",
    notes: SYNC_NOTES[givers.includes("mcleod") ? "mcleod" : (givers[0] ?? source)],
    identifier: null,
    issuingAuthority: null,
    expiresAt: resolved.expiresOn,
  });
  return "error" in res ? { error: res.error } : "written";
}

const PAGE = 1000;

/**
 * Every driver's medical state in one org: the current card (with its scan flag) and every source's
 * claim. Two paged reads, not one per driver — the Med-Stop sweep runs hourly over the whole roster.
 */
export async function readMedicalStates(admin: SupabaseClient, orgId: string): Promise<Map<string, MedicalCardState>> {
  const cards = new Map<string, CurrentMedicalRow>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("certifications")
      .select("subject_id, expires_at, document_id")
      .eq("org_id", orgId)
      .eq("subject_type", "driver")
      .eq("kind", "medical_card")
      .is("superseded_by", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`certifications read failed: ${error.message}`);
    for (const c of data ?? []) {
      // One current row per driver by 0127's model; should two ever be current, the later expiry is
      // the one the qualification gate would honour, so it is the one compared against.
      const prior = cards.get(c.subject_id as string);
      if (!prior || (c.expires_at && (!prior.expires_at || c.expires_at > prior.expires_at))) {
        cards.set(c.subject_id as string, { expires_at: c.expires_at as string | null, document_id: c.document_id as string | null });
      }
    }
    if (!data || data.length < PAGE) break;
  }
  const claims = new Map<string, MedicalSourceDate[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("credential_source_dates")
      .select("driver_id, source, expires_on")
      .eq("org_id", orgId)
      .eq("kind", "medical_card")
      .order("driver_id")
      .order("source")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`credential_source_dates read failed: ${error.message}`);
    for (const r of data ?? []) {
      const list = claims.get(r.driver_id as string) ?? [];
      list.push(...toClaims([r]));
      claims.set(r.driver_id as string, list);
    }
    if (!data || data.length < PAGE) break;
  }
  const out = new Map<string, MedicalCardState>();
  for (const id of new Set([...cards.keys(), ...claims.keys()])) out.set(id, medicalStateOf(cards.get(id), claims.get(id) ?? []));
  return out;
}

export interface MedicalSourceSweepResult {
  written: number;
  unchanged: number;
  failed: number;
}

/**
 * A whole source's claims for one org — the Med-Stop sweep's door (D-MSUX4a). The caller sends
 * CERTAIN matches only (licence or name+DOB, R3); a claim for a driver it could not place is never
 * made. A source that stops mentioning a driver leaves its last claim standing — never a null over a
 * good value, the rule `recordSyncedCredentials` holds for McLeod.
 */
export async function recordMedicalSourceDates(
  admin: SupabaseClient,
  orgId: string,
  source: MedicalSource,
  claims: ReadonlyArray<{ driverId: string; expiresOn: string | null }>,
): Promise<MedicalSourceSweepResult> {
  const out: MedicalSourceSweepResult = { written: 0, unchanged: 0, failed: 0 };
  const states = await readMedicalStates(admin, orgId);
  for (const c of claims) {
    if (!c.expiresOn) continue;
    const filed = await fileMedicalClaim(admin, orgId, c.driverId, source, c.expiresOn, states.get(c.driverId) ?? medicalStateOf(undefined, []));
    if (filed === "written") out.written++;
    else if (filed === "unchanged") out.unchanged++;
    else out.failed++;
  }
  return out;
}
