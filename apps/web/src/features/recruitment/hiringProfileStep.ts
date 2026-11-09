import type { HazmatMode, HiringProfileView, HiringRequirements } from "@silvicom/shared";
import type { Fact } from "@silvicom/ui";

/**
 * The opening drawer's hiring-profile step (Q-AD44 (a)). An opening names one profile VERSION, so the step
 * offers each live profile's newest version; with none, it shows the defaults the API sent (`HIRING_PROFILE_V1`,
 * the owner's 2026-10-26 ruling) for a person to read and save as the first profile. The values come from that
 * answer, never from a copy here; only their words are this file's. A full profile editor is recruiting's.
 */
const HAZMAT_LABEL: Record<HazmatMode, string> = { required: "Required", preferred: "Preferred", off: "Not asked" };

export function profileOptions(profiles: HiringProfileView[]): Array<{ value: string; label: string }> {
  return profiles.flatMap((p) =>
    p.archived_at === null && p.current ? [{ value: p.current.id, label: `${p.name} · version ${p.current.version}` }] : [],
  );
}

/** Each requirement with the reason a recruiter and counsel are shown, read-only. */
export function requirementFacts(r: HiringRequirements): Fact[] {
  return [
    { key: "min_age", label: "Minimum age", value: `${r.min_age.years} · ${r.min_age.reason}` },
    { key: "class_a", label: "Class A CDL", value: `Required · ${r.class_a.reason}` },
    { key: "class_a_years", label: "Class A experience", value: `${r.min_class_a_years.years} years · ${r.min_class_a_years.reason}` },
    { key: "hazmat", label: "Hazmat endorsement", value: `${HAZMAT_LABEL[r.hazmat.mode]} · ${r.hazmat.reason}` },
    // LQ7: home time shares hazmat's three modes; shown only when the profile asks it, so an "off" profile reads as before.
    ...(r.home_time.mode === "off" ? [] : [{ key: "home_time", label: "Time on the road", value: `${HAZMAT_LABEL[r.home_time.mode]} · ${r.home_time.min_days_out} days out · ${r.home_time.reason}` }]),
    { key: "disqualifiers", label: "Disqualifiers", value: r.disqualifiers.reason },
  ];
}
