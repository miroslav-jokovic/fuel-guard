import type { SupabaseClient } from "@supabase/supabase-js";
import { openingVersionRow, type HiringProfileSave, type OpeningSave, type OpeningStatus, type RecruiterOption } from "@silvicom/shared";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { sectionManagerIds } from "../../org/index.js";

/**
 * Saving a hiring profile and an opening (ADS-AGENT-BUILD-WORKFLOW.md D1, the gap D0 recorded: nothing in
 * the plan owned WRITING them, so the owner's first opening — G4 — had nowhere to go).
 *
 * Every save is the next version (0554's `save_hiring_profile_version` / `save_opening_version`, numbered
 * under a row lock), so a verdict and an ad always name the exact requirements and facts they were made
 * from. The contracts (`hiringProfileSaveSchema`, `openingSaveSchema`) validated the body before it got
 * here; the database holds only what must never be false (0553).
 *
 * The lists read the newest version of each — a handful of profiles and tens of openings per carrier, so
 * two reads, never a page.
 */

export interface SetupError { status: number; code: string; message: string }
export const isSetupError = (v: unknown): v is SetupError => typeof v === "object" && v !== null && "code" in v && "status" in v;
type Actor = { userId: string; name: string };

const failure = (code: string | undefined): SetupError | null => {
  if (code === "RL030") return { status: 404, code: "not_found", message: "Not found" };
  if (code === "RL031") return { status: 409, code: "archived", message: "This hiring profile is archived." };
  if (code === "RL034") return { status: 422, code: "profile_not_found", message: "Pick one of this carrier's hiring profiles." };
  return null;
};

interface VersionRow { id: string; version: number; created_by_name: string; created_at: string }

/** The newest version per parent, from one read ordered newest first. */
function newestBy<T extends VersionRow>(rows: T[], key: (r: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) if (!out.has(key(r))) out.set(key(r), r);
  return out;
}

export async function listHiringProfiles(admin: SupabaseClient, orgId: string) {
  const [{ data: profiles, error: pe }, { data: versions, error: ve }] = await Promise.all([
    admin.from("hiring_profiles").select("id, name, archived_at, created_at").eq("org_id", orgId).order("created_at"),
    admin.from("hiring_profile_versions").select("id, profile_id, version, requirements, created_by_name, created_at")
      .eq("org_id", orgId).order("version", { ascending: false }),
  ]);
  if (pe || ve) throw new Error(`Could not read hiring profiles: ${(pe ?? ve)!.message}`);
  const newest = newestBy((versions ?? []) as Array<VersionRow & { profile_id: string; requirements: unknown }>, (r) => r.profile_id);
  return ((profiles ?? []) as Array<{ id: string; name: string; archived_at: string | null; created_at: string }>).map((p) => ({
    ...p, current: newest.get(p.id) ?? null,
  }));
}

export async function saveHiringProfile(admin: SupabaseClient, orgId: string, actor: Actor, save: HiringProfileSave) {
  const { data, error } = await admin.rpc("save_hiring_profile_version", {
    p_org: orgId, p_profile: save.profile_id, p_name: save.name, p_requirements: save.requirements,
    p_actor: actor.userId, p_actor_name: actor.name,
  });
  if (error) {
    const known = failure((error as { code?: string }).code);
    if (known) return known;
    throw new Error(`save_hiring_profile_version failed: ${error.message}`);
  }
  return data as { profile_id: string; version_id: string; version: number };
}

export async function listOpenings(admin: SupabaseClient, orgId: string) {
  const [{ data: openings, error: oe }, { data: versions, error: ve }] = await Promise.all([
    admin.from("recruiting_openings").select("id, status, created_at, recruiter_id").eq("org_id", orgId).order("created_at"),
    admin.from("recruiting_opening_versions")
      .select("id, opening_id, version, profile_version_id, title, facts, headcount, area_label, area_latitude, area_longitude, area_radius_miles, area_reason, created_by_name, created_at")
      .eq("org_id", orgId).order("version", { ascending: false }),
  ]);
  if (oe || ve) throw new Error(`Could not read openings: ${(oe ?? ve)!.message}`);
  const newest = newestBy((versions ?? []) as Array<VersionRow & { opening_id: string }>, (r) => r.opening_id);
  return ((openings ?? []) as Array<{ id: string; status: OpeningStatus; created_at: string; recruiter_id: string | null }>).map((o) => ({
    ...o, current: newest.get(o.id) ?? null,
  }));
}

export async function saveOpening(admin: SupabaseClient, orgId: string, actor: Actor, save: OpeningSave) {
  const { data, error } = await admin.rpc("save_opening_version", {
    p_org: orgId, p_opening: save.opening_id, p_version: openingVersionRow(save), p_actor: actor.userId, p_actor_name: actor.name,
  });
  if (error) {
    const known = failure((error as { code?: string }).code);
    if (known) return known;
    throw new Error(`save_opening_version failed: ${error.message}`);
  }
  return data as { opening_id: string; version_id: string; version: number };
}

/**
 * Open, paused, filled or closed. A status is not a version: it says nothing about what the opening
 * advertises, so it moves on the parent row (0553). Pausing the ads of a closed opening (1.8) is the ads
 * module's, read from this status through the `AdBriefSource` — not a call from here.
 */
export async function setOpeningStatus(admin: SupabaseClient, orgId: string, openingId: string, status: OpeningStatus) {
  const { data, error } = await admin
    .from("recruiting_openings").update({ status }).eq("org_id", orgId).eq("id", openingId).select("id, status").maybeSingle();
  if (error) throw new Error(`Could not change the opening: ${error.message}`);
  return (data as { id: string; status: OpeningStatus } | null) ?? ({ status: 404, code: "not_found", message: "Opening not found" } as SetupError);
}

/**
 * Who owns an opening's leads (LQ2b; 0574; Q-AD50 (a)). Like the status, the owner is not part of what the
 * opening advertises, so it moves on the parent row and mints no version.
 *
 * Only somebody who holds `recruitment: manage` TODAY may be named — the access matrix's answer
 * (`sectionManagerIds`), never a role list kept here. A recruiter whose grant is later taken away keeps the
 * column but stops owning anything: the lead path asks the matrix again at the moment a lead arrives
 * (`leadAssignment.ts`). Null hands the opening back to everyone, as before 0574.
 */
export async function setOpeningRecruiter(admin: SupabaseClient, orgId: string, openingId: string, recruiterId: string | null) {
  if (recruiterId !== null && !(await sectionManagerIds(admin, orgId, "recruitment")).includes(recruiterId)) {
    return { status: 422, code: "not_a_recruiter", message: "Pick somebody who can work recruitment leads." } as SetupError;
  }
  const { data, error } = await admin
    .from("recruiting_openings").update({ recruiter_id: recruiterId }).eq("org_id", orgId).eq("id", openingId)
    .select("id, recruiter_id").maybeSingle();
  if (error) throw new Error(`Could not change the opening's recruiter: ${error.message}`);
  return (data as { id: string; recruiter_id: string | null } | null) ?? ({ status: 404, code: "not_found", message: "Opening not found" } as SetupError);
}

/** The people an opening may be handed to: recruitment managers today, by their name or else their email. */
export async function listRecruiters(admin: SupabaseClient, orgId: string): Promise<RecruiterOption[]> {
  const ids = await sectionManagerIds(admin, orgId, "recruitment");
  const labels = await memberLabels(admin, orgId, ids);
  return ids
    .map((id) => ({ user_id: id, label: labelOf(labels.get(id)) ?? "A team member" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
