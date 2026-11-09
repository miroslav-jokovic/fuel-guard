import type { AdNameLanguage } from "./naming.js";

/**
 * What each CONCEPT (preset) of a campaign did, folded from the per-ad hours (ADS-CREATIVE-QUALITY-PLAN CQ3's reader;
 * D-AD22). Pure: rows in, a line per preset out. The API reads `ads_ad_spend_hourly` (one row per Meta ad per hour,
 * naming the creative and language the publisher recorded) and the creatives' preset versions, and calls this; the
 * Campaigns tab shows the result, and D-AD11's reweighting of the draw will read it once Q-AD59's floor is met.
 *
 * ── THE FIGURE A CONCEPT IS JUDGED BY ─────────────────────────────────────────────────────────────
 * Cost per lead is the platform's own measure and the one the monitor's `cpl_max` already pauses on; it is given
 * here per preset and per language. It is NOT the figure the draw will be weighted by: R4's caveat (cheap junk looks
 * like a winner) and Q-AD59's ruling point at cost per CONVERTED lead, which needs the outcome feed joined to the ad
 * — a later reader, on this fold's shape. `cost_per_lead_cents` is null, never 0, when no lead came: a concept that
 * spent and brought nothing is not "free", it is unmeasured on that figure (`a-no-op-write-is-invisible`).
 *
 * A row whose creative no campaign row names (a creative deleted by nobody, since nothing deletes) is dropped,
 * not guessed into a preset. Presets come out in key order (P1…), so the table reads the same every day.
 */

export interface AdHourFact {
  creative_id: string;
  language: AdNameLanguage;
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
}

export interface ConceptCreative {
  id: string;
  preset_version_id: string;
}

export interface ConceptPreset {
  version_id: string;
  key: string;
}

export interface ConceptLanguageTotals {
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
  cost_per_lead_cents: number | null;
}

export interface ConceptPerformance extends ConceptLanguageTotals {
  preset_key: string;
  /** Every version of the preset a creative of this campaign used; usually one. */
  preset_version_ids: string[];
  creatives: number;
  by_language: Record<AdNameLanguage, ConceptLanguageTotals>;
}

/** `GET /api/ads/campaigns/:id/concepts`: the fold over the last window of hours. */
export interface CampaignConcepts {
  campaign_id: string;
  /** The window's first hour (UTC instant) and the moment it was read. */
  since: string;
  read_at: string;
  concepts: ConceptPerformance[];
}

const zero = (): ConceptLanguageTotals => ({ spend_cents: 0, impressions: 0, clicks: 0, leads: 0, cost_per_lead_cents: null });

function add(t: ConceptLanguageTotals, r: AdHourFact): void {
  t.spend_cents += r.spend_cents;
  t.impressions += r.impressions;
  t.clicks += r.clicks;
  t.leads += r.leads;
}

/** Whole cents, rounded half up, or null when no lead came. */
export const costPerLeadCents = (spend_cents: number, leads: number): number | null => (leads > 0 ? Math.round(spend_cents / leads) : null);

function settle(t: ConceptLanguageTotals): ConceptLanguageTotals {
  return { ...t, cost_per_lead_cents: costPerLeadCents(t.spend_cents, t.leads) };
}

export function foldConcepts(rows: readonly AdHourFact[], creatives: readonly ConceptCreative[], presets: readonly ConceptPreset[]): ConceptPerformance[] {
  const keyOfVersion = new Map(presets.map((p) => [p.version_id, p.key]));
  const presetOfCreative = new Map<string, { key: string; version_id: string }>();
  for (const c of creatives) {
    const key = keyOfVersion.get(c.preset_version_id);
    if (key) presetOfCreative.set(c.id, { key, version_id: c.preset_version_id });
  }
  const out = new Map<string, { totals: ConceptLanguageTotals; by: Record<AdNameLanguage, ConceptLanguageTotals>; versions: Set<string>; creatives: Set<string> }>();
  const slot = (key: string) => {
    let s = out.get(key);
    if (!s) out.set(key, (s = { totals: zero(), by: { en: zero(), es: zero() }, versions: new Set(), creatives: new Set() }));
    return s;
  };
  // Every creative of the campaign has a line, spent or not: a concept that never ran reads as zero, not as absent.
  for (const [creativeId, p] of presetOfCreative) {
    const s = slot(p.key);
    s.versions.add(p.version_id);
    s.creatives.add(creativeId);
  }
  for (const r of rows) {
    const p = presetOfCreative.get(r.creative_id);
    if (!p) continue;
    const s = slot(p.key);
    add(s.totals, r);
    add(s.by[r.language], r);
  }
  return [...out.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([preset_key, s]) => ({
      preset_key, preset_version_ids: [...s.versions].sort(), creatives: s.creatives.size,
      ...settle(s.totals),
      by_language: { en: settle(s.by.en), es: settle(s.by.es) },
    }));
}
