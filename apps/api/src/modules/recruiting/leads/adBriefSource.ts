import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OPENING_BRIEF_SOURCE, hiringRequirementsSchema, isRecordId, openingBrief, openingFactsSchema,
  type AdBrief, type AdBriefSource,
} from "@silvicom/shared";

/**
 * Recruiting as an `AdBriefSource` (D-AD17; ADS-AGENT-BUILD-WORKFLOW S1b): an OPEN opening's newest
 * version, with the hiring-profile version it names, turned into a brief by the shared `openingBrief`.
 * Read-only: the ads module freezes what this returns in `ads_campaigns.brief_snapshot` and never reads
 * an opening itself. The composition root hands it to the ads router, as it hands over the `LeadSink`.
 *
 * Null — "no publishable thing" — when the ref is not an opening id, the opening does not exist in this
 * org, is not `open` (paused, filled and closed openings are not advertised; 1.8), has no version, or a
 * stored row no longer parses under today's contract. Each is a person's to fix on the opening screen,
 * and none is guessed around.
 */
export function recruitingBriefSource(admin: SupabaseClient): AdBriefSource {
  return { source: OPENING_BRIEF_SOURCE, briefFor: (orgId, ref) => openingBriefFor(admin, orgId, ref) };
}

async function openingBriefFor(admin: SupabaseClient, orgId: string, ref: string): Promise<AdBrief | null> {
  if (!isRecordId(ref)) return null;
  const { data: opening, error: oe } = await admin.from("recruiting_openings").select("id, status").eq("org_id", orgId).eq("id", ref).maybeSingle();
  if (oe) throw new Error(`recruiting_openings: ${oe.message}`);
  if (!opening || (opening as { status: string }).status !== "open") return null;

  const { data: v, error: ve } = await admin
    .from("recruiting_opening_versions")
    .select("version, profile_version_id, title, facts, area_label, area_latitude, area_longitude, area_radius_miles, area_reason")
    .eq("org_id", orgId).eq("opening_id", ref).order("version", { ascending: false }).limit(1).maybeSingle();
  if (ve) throw new Error(`recruiting_opening_versions: ${ve.message}`);
  if (!v) return null;
  const row = v as OpeningVersionRow;

  const { data: p, error: pe } = await admin.from("hiring_profile_versions").select("requirements").eq("org_id", orgId).eq("id", row.profile_version_id).maybeSingle();
  if (pe) throw new Error(`hiring_profile_versions: ${pe.message}`);
  const facts = openingFactsSchema.safeParse(row.facts);
  const req = hiringRequirementsSchema.safeParse((p as { requirements: unknown } | null)?.requirements);
  if (!facts.success || !req.success) return null;

  return openingBrief({
    opening_id: ref,
    version: row.version,
    title: row.title,
    facts: facts.data,
    area: { label: row.area_label, latitude: row.area_latitude, longitude: row.area_longitude, radius_miles: row.area_radius_miles, reason: row.area_reason },
  }, req.data);
}

interface OpeningVersionRow {
  version: number;
  profile_version_id: string;
  title: string;
  facts: unknown;
  area_label: string;
  area_latitude: number;
  area_longitude: number;
  area_radius_miles: number;
  area_reason: string;
}
