import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fillMedstopApplicantForm,
  medstopApplicantSkip,
  type MedstopApplicantCreateView,
  type MedstopApplicantFacts,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { MedstopClient, MedstopError } from "./client.js";
import { getCredential } from "./credentials.js";

/**
 * Creating the applicant in Med-Stop when Part 1 is complete (MEDSTOP-PLAN.md §7A.13, D-MS1, UX5c) —
 * Med-Stop's half. Recruiting says who finished Part 1 and what it says (`partOneFactsForMedstop`);
 * the queue's Med-Stop job hands that here after the sweep has refreshed the roster mirror.
 *
 * In this order, for each applicant:
 *   1. Ordering is switched on for this org (D-MSUX11). There is no Med-Stop test host, so an
 *      applicant created from staging would be a fake person in the carrier's real account — the same
 *      reason ordering ships off (0468). Off means nobody is created, anywhere.
 *   2. Never attempted before (`medstop_applicant_creates`, 0471 — one attempt per application, ever).
 *   3. Med-Stop does not already hold them: ANY match in the fresh mirror, on ANY roster, by ANY rule —
 *      a name-only match is a "maybe", and a maybe is not created twice. A leaver who re-applies is
 *      rehired in Med-Stop by the office, not duplicated by us.
 *   4. `medstopApplicantSkip` — gender declined or never asked, a licence from outside the US.
 *   5. Med-Stop's own blank form (`GET /Employee/new`), filled by `fillMedstopApplicantForm`; nothing is
 *      sent while a required key is empty.
 *   6. The attempt is CLAIMED (a row, `unknown`) before the POST, then the POST goes once
 *      (`client.write`, never retried), then the row says what happened. A process that dies between
 *      the POST and the update leaves `unknown` — never a second create.
 */
export interface MedstopApplicantCreateResult {
  created: number;
  refused: number;
  unknown: number;
  skipped: number;
  ordersOff: boolean;
}

/** At most this many creates per sweep: an hour's hiring is a handful, and a burst is a bug. */
export const MEDSTOP_CREATES_PER_SWEEP = 10;
const CHUNK = 100;

async function attemptedOf(admin: SupabaseClient, orgId: string, invitationIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < invitationIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("medstop_applicant_creates")
      .select("invitation_id")
      .eq("org_id", orgId)
      .in("invitation_id", invitationIds.slice(i, i + CHUNK));
    if (error) throw new Error(`medstop_applicant_creates read failed: ${error.message}`);
    for (const r of (data ?? []) as { invitation_id: string }[]) out.add(r.invitation_id);
  }
  return out;
}

async function heldByMedstop(admin: SupabaseClient, orgId: string, driverIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < driverIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("medstop_employees")
      .select("driver_id")
      .eq("org_id", orgId)
      .in("driver_id", driverIds.slice(i, i + CHUNK));
    if (error) throw new Error(`medstop_employees read failed: ${error.message}`);
    for (const r of (data ?? []) as { driver_id: string | null }[]) if (r.driver_id) out.add(r.driver_id);
  }
  return out;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

async function finish(
  admin: SupabaseClient,
  orgId: string,
  f: MedstopApplicantFacts,
  outcome: MedstopApplicantCreateView["outcome"],
  medstopId: string | null,
  message: string | null,
): Promise<void> {
  const { error } = await admin
    .from("medstop_applicant_creates")
    .update({ outcome, medstop_id: medstopId, message })
    .eq("org_id", orgId)
    .eq("invitation_id", f.invitationId);
  if (error) throw new Error(`medstop_applicant_creates update failed: ${error.message}`);
  // Ids only: the form carried a licence and a date of birth, and the audit log is read more widely.
  await writeAudit(admin, {
    orgId,
    actorId: null,
    action: `medstop.applicant.${outcome}`,
    entity: "application_invitations",
    entityId: f.invitationId,
    meta: { driverId: f.driverId, medstopId },
  });
}

export async function createMedstopApplicants(
  admin: SupabaseClient,
  client: MedstopClient,
  orgId: string,
  loadFacts: () => Promise<MedstopApplicantFacts[]>,
): Promise<MedstopApplicantCreateResult> {
  const result: MedstopApplicantCreateResult = { created: 0, refused: 0, unknown: 0, skipped: 0, ordersOff: false };
  if (!(await getCredential(admin, orgId))?.ordersEnabled) return { ...result, ordersOff: true };

  const facts = await loadFacts();
  if (facts.length === 0) return result;
  const attempted = await attemptedOf(admin, orgId, facts.map((f) => f.invitationId));
  const held = await heldByMedstop(admin, orgId, [...new Set(facts.map((f) => f.driverId))]);

  let sent = 0;
  for (const f of facts) {
    if (attempted.has(f.invitationId) || held.has(f.driverId)) continue;
    if (medstopApplicantSkip(f)) {
      result.skipped++;
      continue;
    }
    if (sent >= MEDSTOP_CREATES_PER_SWEEP) break;

    const blank = (await client.read("/Employee/new")) as { data?: Record<string, unknown> } | null;
    if (!blank?.data || typeof blank.data !== "object") throw new Error("Med-Stop did not hand out its new-employee form");
    const filled = fillMedstopApplicantForm(blank.data, f);
    if ("missing" in filled) {
      result.skipped++;
      continue;
    }

    // Claim first (see the header, step 6). A unique violation means another sweep claimed it.
    const { error: claimErr } = await admin
      .from("medstop_applicant_creates")
      .insert({ org_id: orgId, invitation_id: f.invitationId, outcome: "unknown", message: "Sending to Med-Stop" });
    if (claimErr) {
      if (claimErr.code === "23505") continue;
      throw new Error(`medstop_applicant_creates claim failed: ${claimErr.message}`);
    }
    sent++;
    try {
      const answer = (await client.write("POST", "/Employee/new", filled.form)) as { data?: { id?: unknown; eeid?: unknown } } | null;
      await finish(admin, orgId, f, "created", text(answer?.data?.eeid) ?? text(answer?.data?.id), null);
      result.created++;
    } catch (e) {
      const unknown = e instanceof MedstopError && e.kind === "transport";
      const message = unknown
        ? "Med-Stop did not answer, so the applicant may or may not have been created. Check Med-Stop before adding them."
        : e instanceof Error ? e.message : String(e);
      await finish(admin, orgId, f, unknown ? "unknown" : "refused", null, message);
      result[unknown ? "unknown" : "refused"]++;
    }
  }
  return result;
}

/** The newest create attempt among these invitations — the hiring step's line. */
export async function readApplicantCreate(
  admin: SupabaseClient,
  orgId: string,
  invitationIds: string[],
): Promise<MedstopApplicantCreateView | null> {
  if (invitationIds.length === 0) return null;
  const { data, error } = await admin
    .from("medstop_applicant_creates")
    .select("outcome, message, attempted_at")
    .eq("org_id", orgId)
    .in("invitation_id", invitationIds.slice(0, CHUNK))
    .order("attempted_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`medstop_applicant_creates read failed: ${error.message}`);
  const row = (data ?? [])[0] as { outcome: MedstopApplicantCreateView["outcome"]; message: string | null; attempted_at: string } | undefined;
  return row ? { outcome: row.outcome, message: row.message, at: row.attempted_at } : null;
}
