import type { SupabaseClient } from "@supabase/supabase-js";
import { DONOR_GENDERS, type DonorGender, type MedstopApplicantFacts } from "@silvicom/shared";

/**
 * The applicants Med-Stop should be told about (MEDSTOP-PLAN.md §7A.13, D-MS1, UX5c) — recruiting's
 * half: whose Part 1 is finished, and what it says. Med-Stop's half (who it already holds, the form,
 * the one write) is `modules/medstop/applicantCreate.ts`; the queue's Med-Stop job joins the two, so
 * neither module reads the other's tables.
 *
 * Who is offered: an invitation whose Part 1 is COMPLETE (`intake_completed_at` — the event D-MS1
 * names) and not revoked, for a driver who is still an applicant, not archived, and whose application
 * has not ended (any `applicant_dispositions` row — declined, withdrawn, no response — is an ending,
 * and a person we are not hiring is not put into the carrier's Med-Stop).
 *
 * ⚠ `donor_gender` is read here and passed to Med-Stop's form, and nowhere else: this list never
 * reaches a browser (0469, D-MSUX10).
 *
 * Every query org-filters itself: the service role bypasses RLS.
 */
const CHUNK = 100;

type InvitationRow = { id: string; driver_id: string };
type IntakeRow = {
  invitation_id: string; donor_gender: string | null; phone: string | null; address_line1: string | null;
  address_line2: string | null; city: string | null; state: string | null; postal_code: string | null;
};
type LicenceRow = { invitation_id: string; state_code: string | null; licence_number: string | null; expires_on: string | null };
type DriverRow = {
  id: string; first_name: string | null; middle_name: string | null; last_name: string | null; date_of_birth: string | null;
  cdl_class: string | null; status: string; archived_at: string | null;
};

async function inChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  // `.in()` lists ride in the URL; Node 22 refuses an over-long one ("fetch failed").
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await read(ids.slice(i, i + CHUNK))));
  return out;
}

const gender = (v: string | null): DonorGender | null => ((DONOR_GENDERS as readonly string[]).includes(v ?? "") ? (v as DonorGender) : null);

export async function partOneFactsForMedstop(admin: SupabaseClient, orgId: string): Promise<MedstopApplicantFacts[]> {
  const { data: inv, error: invErr } = await admin
    .from("application_invitations")
    .select("id, driver_id")
    .eq("org_id", orgId)
    .not("intake_completed_at", "is", null)
    .is("revoked_at", null)
    .limit(1000);
  if (invErr) throw new Error(`application_invitations read failed: ${invErr.message}`);
  const invitations = (inv ?? []) as InvitationRow[];
  if (invitations.length === 0) return [];
  const invIds = invitations.map((i) => i.id);
  const driverIds = [...new Set(invitations.map((i) => i.driver_id))];

  const [intakes, licences, drivers, ended] = await Promise.all([
    inChunks(invIds, async (c) => {
      const { data, error } = await admin
        .from("application_intakes")
        .select("invitation_id, donor_gender, phone, address_line1, address_line2, city, state, postal_code")
        .eq("org_id", orgId)
        .in("invitation_id", c);
      if (error) throw new Error(`application_intakes read failed: ${error.message}`);
      return (data ?? []) as IntakeRow[];
    }),
    inChunks(invIds, async (c) => {
      const { data, error } = await admin
        .from("application_intake_licences")
        .select("invitation_id, state_code, licence_number, expires_on")
        .eq("org_id", orgId)
        .eq("position", 0)
        .in("invitation_id", c);
      if (error) throw new Error(`application_intake_licences read failed: ${error.message}`);
      return (data ?? []) as LicenceRow[];
    }),
    inChunks(driverIds, async (c) => {
      const { data, error } = await admin
        .from("drivers")
        .select("id, first_name, middle_name, last_name, date_of_birth, cdl_class, status, archived_at")
        .eq("org_id", orgId)
        .in("id", c);
      if (error) throw new Error(`drivers read failed: ${error.message}`);
      return (data ?? []) as DriverRow[];
    }),
    inChunks(driverIds, async (c) => {
      const { data, error } = await admin.from("applicant_dispositions").select("driver_id").eq("org_id", orgId).in("driver_id", c);
      if (error) throw new Error(`applicant_dispositions read failed: ${error.message}`);
      return (data ?? []) as { driver_id: string }[];
    }),
  ]);

  const intakeOf = new Map(intakes.map((r) => [r.invitation_id, r]));
  const licenceOf = new Map(licences.map((r) => [r.invitation_id, r]));
  const driverOf = new Map(drivers.map((r) => [r.id, r]));
  const endedDrivers = new Set(ended.map((r) => r.driver_id));

  const out: MedstopApplicantFacts[] = [];
  for (const i of invitations) {
    const d = driverOf.get(i.driver_id);
    const intake = intakeOf.get(i.id);
    // The query's conditions are held again here: this list decides who is written into Med-Stop.
    if (!d || !intake || d.status !== "applicant" || d.archived_at !== null || endedDrivers.has(d.id)) continue;
    const l = licenceOf.get(i.id);
    out.push({
      invitationId: i.id,
      driverId: d.id,
      firstName: d.first_name,
      middleName: d.middle_name,
      lastName: d.last_name,
      birthDate: d.date_of_birth,
      gender: gender(intake.donor_gender),
      addressLine1: intake.address_line1,
      addressLine2: intake.address_line2,
      city: intake.city,
      state: intake.state,
      postalCode: intake.postal_code,
      phone: intake.phone,
      licenceNumber: l?.licence_number ?? null,
      licenceState: l?.state_code ?? null,
      licenceExpiresOn: l?.expires_on ?? null,
      cdlClass: d.cdl_class,
    });
  }
  return out;
}

/** The invitations of one driver — the hiring step asks Med-Stop's record of their create attempts by these. */
export async function invitationIdsOf(admin: SupabaseClient, orgId: string, driverId: string): Promise<string[]> {
  const { data, error } = await admin.from("application_invitations").select("id").eq("org_id", orgId).eq("driver_id", driverId);
  if (error) throw new Error(`application_invitations read failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}
