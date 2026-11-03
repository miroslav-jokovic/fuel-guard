import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hiringRequirementsSchema,
  leadFactsFromAnswers,
  leadMatch,
  summariseLeadMatch,
  type LeadMatchSummary,
  type LeadMatchVerdict,
} from "@silvicom/shared";

/**
 * `leadMatch` verdicts for one lead, written as `lead_match_verdicts` rows (0553; D-RA3, D-LS4). The rules
 * are the shared pure function; this file only finds the profile version to judge against and stores the
 * answer.
 *
 * ── WHICH PROFILE ────────────────────────────────────────────────────────────────────────────────
 * The one the lead's OPENING pins (its newest version's `profile_version_id`). A lead with no opening — a
 * phone call a recruiter typed in without picking one — has no profile to be judged against, and gets no
 * verdicts rather than a guess at which profile was meant; the queue still shows it, unsorted by match.
 *
 * ── WRITTEN ONCE PER (lead, profile version), AND HEALED ON A RETRY ──────────────────────────────
 * Verdicts are recomputed by writing new rows, never edited (RL014). This writes only when the lead has
 * none for that profile version yet — so a webhook retried after the lead was stored but before its
 * verdicts were (a crash between the two) writes them on the retry, and a retry after both is a no-op.
 */
export async function recordLeadVerdicts(
  admin: SupabaseClient,
  orgId: string,
  leadId: string,
  openingId: string | null,
  answers: Record<string, string>,
  asOf: string,
): Promise<number> {
  if (!openingId) return 0;
  const { data: opening, error: oe } = await admin
    .from("recruiting_opening_versions")
    .select("profile_version_id")
    .eq("org_id", orgId)
    .eq("opening_id", openingId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (oe) throw new Error(`Could not read the lead's opening: ${oe.message}`);
  const profileVersionId = (opening as { profile_version_id: string } | null)?.profile_version_id;
  if (!profileVersionId) return 0;

  const [{ data: pv, error: pe }, { data: existing, error: ee }] = await Promise.all([
    admin.from("hiring_profile_versions").select("requirements").eq("org_id", orgId).eq("id", profileVersionId).maybeSingle(),
    admin.from("lead_match_verdicts").select("id").eq("org_id", orgId).eq("lead_id", leadId)
      .eq("profile_version_id", profileVersionId).limit(1),
  ]);
  if (pe || ee) throw new Error(`Could not read the profile or the lead's verdicts: ${(pe ?? ee)!.message}`);
  if ((existing ?? []).length > 0) return 0;
  const parsed = hiringRequirementsSchema.safeParse((pv as { requirements: unknown } | null)?.requirements);
  // A stored version that no longer parses is a contract change nobody migrated; refusing loudly beats
  // writing verdicts against requirements we cannot read.
  if (!parsed.success) throw new Error(`Hiring profile version ${profileVersionId} does not match the contract`);

  const rows = leadMatch(parsed.data, leadFactsFromAnswers(answers), asOf).map((v) => ({
    org_id: orgId,
    lead_id: leadId,
    profile_version_id: profileVersionId,
    requirement: v.requirement,
    verdict: v.verdict,
    evidence: v.evidence,
    detail: { ...v.detail, hard: v.hard },
  }));
  const { error } = await admin.from("lead_match_verdicts").insert(rows);
  if (error) throw new Error(`Could not record the lead's verdicts: ${error.message}`);
  return rows.length;
}

interface VerdictRow {
  lead_id: string;
  requirement: LeadMatchVerdict["requirement"];
  verdict: LeadMatchVerdict["verdict"];
  evidence: LeadMatchVerdict["evidence"];
  detail: Record<string, unknown> & { hard?: boolean };
  computed_at: string;
}

/** The newest verdict per (lead, requirement) for these leads, with each lead's summary. One read. */
export async function readLeadVerdicts(
  admin: SupabaseClient,
  orgId: string,
  leadIds: readonly string[],
): Promise<Map<string, { verdicts: LeadMatchVerdict[]; summary: LeadMatchSummary }>> {
  const out = new Map<string, { verdicts: LeadMatchVerdict[]; summary: LeadMatchSummary }>();
  if (leadIds.length === 0) return out;
  // The queue pages at most 100 leads, so one `.in()` stays well inside a URL (the Node 22 header limit).
  const { data, error } = await admin
    .from("lead_match_verdicts")
    .select("lead_id, requirement, verdict, evidence, detail, computed_at")
    .eq("org_id", orgId)
    .in("lead_id", [...leadIds])
    .order("computed_at", { ascending: false });
  if (error) throw new Error(`Could not read lead verdicts: ${error.message}`);
  const seen = new Set<string>();
  const byLead = new Map<string, LeadMatchVerdict[]>();
  for (const r of (data ?? []) as VerdictRow[]) {
    const key = `${r.lead_id}|${r.requirement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { hard, ...detail } = r.detail ?? {};
    const list = byLead.get(r.lead_id) ?? [];
    list.push({ requirement: r.requirement, hard: hard !== false, verdict: r.verdict, evidence: r.evidence, detail });
    byLead.set(r.lead_id, list);
  }
  for (const [id, verdicts] of byLead) out.set(id, { verdicts, summary: summariseLeadMatch(verdicts) });
  return out;
}
