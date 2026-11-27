import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAREERS_HANDLE_PATTERN,
  hiringRequirementsSchema,
  isRecordId,
  openingFactsSchema,
  openingUnpublishedReason,
  type ApplyAccommodation,
  type HiringRequirements,
  type OpeningFacts,
  type OpeningStatus,
} from "@silvicom/shared";
import { listOpenings } from "../leads/hiringSetup.js";

/**
 * What the public careers page reads (APPLY-PAGE-PLAN AP2, D-AP1/D-AP2).
 *
 * ── THE ONE QUERY NOT SCOPED TO AN ORG ──────────────────────────────────────────────────────────
 * `findCareersPage` looks a carrier up by its handle, as Tenstreet's receiver looks one up by its key's hash: that is
 * how a request from nobody names a carrier. Every query after it is scoped to the org it found, and an opening id
 * from another carrier answers exactly as one that does not exist.
 */

export interface PublicCareersPage {
  orgId: string;
  handle: string;
  accommodation: ApplyAccommodation;
}

/** The carrier whose page is ON at this handle, or null. A handle people cannot type is not even asked about. */
export async function findCareersPage(admin: SupabaseClient, handle: string): Promise<PublicCareersPage | null> {
  if (!CAREERS_HANDLE_PATTERN.test(handle)) return null;
  const { data, error } = await admin
    .from("recruiting_careers_pages")
    .select("org_id, handle, accommodation_email, accommodation_phone")
    .eq("handle", handle)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw new Error(`recruiting_careers_pages: ${error.message}`);
  const row = data as { org_id: string; handle: string; accommodation_email: string | null; accommodation_phone: string | null } | null;
  return row ? { orgId: row.org_id, handle: row.handle, accommodation: { email: row.accommodation_email, phone: row.accommodation_phone } } : null;
}

export interface PublishedOpening {
  id: string;
  status: OpeningStatus;
  title: string;
  facts: OpeningFacts;
  areaLabel: string;
  profileVersionId: string;
}

/**
 * The carrier's published openings (D-AP2: open, a saved version, the top of its pay range), oldest first, as the
 * Openings tab lists them. A version whose facts no longer parse is left out and logged rather than shown half-read.
 */
export async function publishedOpenings(admin: SupabaseClient, orgId: string): Promise<PublishedOpening[]> {
  const out: PublishedOpening[] = [];
  for (const o of await listOpenings(admin, orgId)) {
    const current = o.current as { title: string; facts: unknown; area_label: string; profile_version_id: string } | null;
    if (!current) continue;
    const facts = openingFactsSchema.safeParse(current.facts);
    if (!facts.success) {
      console.error(`[apply-page] org ${orgId}: opening ${o.id}'s facts do not parse; left off the careers page`);
      continue;
    }
    if (openingUnpublishedReason(o.status, { facts: facts.data }) !== null) continue;
    out.push({ id: o.id, status: o.status, title: current.title, facts: facts.data, areaLabel: current.area_label, profileVersionId: current.profile_version_id });
  }
  return out;
}

export async function publishedOpening(admin: SupabaseClient, orgId: string, openingId: string): Promise<PublishedOpening | null> {
  if (!isRecordId(openingId)) return null;
  return (await publishedOpenings(admin, orgId)).find((o) => o.id === openingId) ?? null;
}

/** The hiring profile version an opening names, org-scoped. Throws when it is missing or unreadable: no page is better than a wrong one. */
export async function openingRequirements(admin: SupabaseClient, orgId: string, profileVersionId: string): Promise<HiringRequirements> {
  const { data, error } = await admin.from("hiring_profile_versions").select("requirements").eq("org_id", orgId).eq("id", profileVersionId).maybeSingle();
  if (error) throw new Error(`hiring_profile_versions: ${error.message}`);
  const parsed = hiringRequirementsSchema.safeParse((data as { requirements?: unknown } | null)?.requirements);
  if (!parsed.success) throw new Error(`hiring_profile_versions: ${profileVersionId} is missing or does not parse`);
  return parsed.data;
}
