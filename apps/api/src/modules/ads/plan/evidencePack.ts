import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AD_HOOK_FAMILIES, AD_HOOK_FAMILY_LABELS, AD_SCENE_FAMILIES, AD_SCENE_FAMILY_LABELS, ADS_BENCHMARK_SUGGESTIONS,
  adBriefSchema, closedReasonWords, evidencePackSchema, foldConcepts, jobEvidence, showMoney,
  type AdBrief, type AdHourFact, type ConceptPerformance, type EvidenceItem, type EvidencePack, type LeadQuality, type LeadQualityCounts,
} from "@silvicom/shared";
import { CONCEPT_WINDOW_DAYS } from "../monitor/conceptPerformance.js";

/**
 * The evidence a campaign's plan is written from (ADS-PLATFORM-V2-PLAN V2c; owner 2026-11-14: decisions "based
 * on real research and analysis and not on some assumptions"). Built by CODE, never by a model: every item is a
 * row we hold or a constant we cite, turned into one sentence with an id the plan must cite (`checkPlan`).
 *
 * ── WHAT IS IN THE PACK TODAY ──────────────────────────────────────────────────────────────────────────
 *   job           the opening's own facts (`jobEvidence`, from the campaign's brief snapshot) — the only place
 *                 an ad's figures may come from (D-AD1).
 *   benchmark     the industry figures the settings screen already cites (`ADS_BENCHMARK_SUGGESTIONS`), read
 *                 from that constant so the plan and the screen cannot quote two numbers.
 *   lead_outcome  what the carrier's ad leads turned out to be once people called them: COUNTS, handed over
 *                 by recruiting (`LeadQuality`, D-AD17 — ads reads no recruiting table). No name, phone or
 *                 e-mail can arrive through it: the interface carries none (Q-APX2).
 *   our_result    what each concept did — the SAME fold the Campaigns tab shows (`foldConcepts`), keyed by
 *                 hook and scene instead of by preset, because hook and scene are what an angle names.
 * Not built: `swipe` (ads a recruiter saved) and `market` (what the Researcher reads) — later V2 steps.
 *
 * ── WHY THE CARRIER'S WHOLE BOOK AND NOT THIS CAMPAIGN'S ───────────────────────────────────────────────
 * A campaign being planned has run nothing. Its evidence is what the carrier's OTHER campaigns did in the
 * window, so both readers here are org-wide — and every query names the org itself, since the service role
 * bypasses RLS. Each sentence says "our ads" / "our ad leads" and the window, so the Strategist is never told a
 * figure belongs to this opening when it does not.
 *
 * ── A COUNT OF ZERO IS NOT EVIDENCE ────────────────────────────────────────────────────────────────────
 * No leads in the window produces no lead item, and a concept that never spent produces no result item. A
 * carrier's first campaign is therefore planned from the job and the benchmark alone, and the pack says so by
 * what it does not hold — never by "0 leads were out of area", which reads as a finding.
 *
 * The window is `CONCEPT_WINDOW_DAYS` for both readers: the reconcile revises that many days of insights, so
 * an older hour is a figure nobody corrects any more (`monitor/conceptPerformance.ts`).
 */

export interface EvidenceDeps {
  admin: SupabaseClient;
  now: () => Date;
  quality: LeadQuality;
}

export type EvidenceOutcome =
  | { ok: true; brief: AdBrief; evidence: EvidencePack }
  | { ok: false; error: string };

const PAGE = 1000;
/** `.in()` lists ride the URL; a long one overflows Node's header limit, so ids go a hundred at a time. */
const IN_CHUNK = 100;

export async function buildEvidencePack(deps: EvidenceDeps, campaign: { id: string; org_id: string }): Promise<EvidenceOutcome> {
  const { data, error } = await deps.admin.from("ads_campaigns").select("brief_snapshot").eq("org_id", campaign.org_id).eq("id", campaign.id).maybeSingle();
  if (error) throw new Error(`ads_campaigns: ${error.message}`);
  if (!data) return { ok: false, error: "the campaign was not found" };
  const brief = adBriefSchema.safeParse((data as { brief_snapshot: unknown }).brief_snapshot);
  if (!brief.success) return { ok: false, error: "the campaign's brief does not parse" };

  const now = deps.now();
  const since = new Date(now.getTime() - CONCEPT_WINDOW_DAYS * 86_400_000);
  since.setUTCMinutes(0, 0, 0);
  const [quality, concepts] = await Promise.all([
    deps.quality.qualitySince(campaign.org_id, since.toISOString()),
    conceptResults(deps.admin, campaign.org_id, since),
  ]);
  const pack = evidencePackSchema.safeParse([
    ...jobEvidence(brief.data),
    benchmarkEvidence(),
    ...leadEvidence(quality),
    ...resultEvidence(concepts),
  ]);
  // An item this file built that the contract refuses is our fault, and the reason is the planner's failure line.
  if (!pack.success) return { ok: false, error: `the evidence pack does not hold: ${pack.error.issues[0]?.message ?? "invalid"}` };
  return { ok: true, brief: brief.data, evidence: pack.data };
}

const WINDOW = `in the last ${CONCEPT_WINDOW_DAYS} days`;

export function benchmarkEvidence(): EvidenceItem {
  const b = ADS_BENCHMARK_SUGGESTIONS;
  return {
    id: "benchmark:cost_per_lead", kind: "benchmark", source: null,
    text: `${b.source}: an ad costing more than ${showMoney(b.cpl_max_cents)} per lead after ${b.cpl_min_leads} leads, or ${showMoney(b.no_lead_spend_cents)} spent with no lead, is where pausing is suggested.`,
  };
}

/** The carrier's ad leads of the window, summed over its campaigns. Counts only; nothing when no lead arrived. */
export function leadEvidence(rows: readonly LeadQualityCounts[]): EvidenceItem[] {
  const sum = (pick: (r: LeadQualityCounts) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const leads = sum((r) => r.leads);
  if (leads === 0) return [];
  const attempted = sum((r) => r.attempted);
  const item = (slug: string, text: string): EvidenceItem => ({ id: `lead_outcome:${slug}`, kind: "lead_outcome", text, source: null });
  const items = [item("reached", `Of ${leads} of our ad leads ${WINDOW}, ${attempted} were called and ${sum((r) => r.reached)} were reached.`)];
  const notQualified = sum((r) => r.not_qualified);
  if (notQualified > 0) items.push(item("not_qualified", `${notQualified} of ${leads} of our ad leads ${WINDOW} did not meet a hard requirement of the opening.`));
  const wrong = sum((r) => r.wrong_number);
  if (wrong > 0) items.push(item("wrong_number", `${wrong} of the ${attempted} ad leads we called ${WINDOW} had a wrong number.`));
  const closed = new Map<string, number>();
  for (const r of rows) for (const [key, n] of Object.entries(r.closed)) closed.set(key, (closed.get(key) ?? 0) + n);
  for (const [key, n] of [...closed.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (n > 0) items.push(item(`closed_${key}`, `${n} of ${leads} of our ad leads ${WINDOW} were closed as: ${closedReasonWords(key)}.`));
  }
  return items;
}

/** One sentence per concept that spent. `preset_key` here is the hook and scene pair (`conceptResults`). */
export function resultEvidence(concepts: readonly ConceptPerformance[]): EvidenceItem[] {
  return concepts.filter((c) => c.spend_cents > 0).map((c) => {
    const [hook, scene] = c.preset_key.split("+") as [keyof typeof AD_HOOK_FAMILY_LABELS, keyof typeof AD_SCENE_FAMILY_LABELS];
    const outcome = c.cost_per_lead_cents === null
      ? "brought no lead"
      : `brought ${c.leads} lead${c.leads === 1 ? "" : "s"}, ${showMoney(c.cost_per_lead_cents)} per lead`;
    return {
      id: `our_result:${hook}_${scene}`, kind: "our_result" as const, source: null,
      text: `Our ads with hook ${hook} (${AD_HOOK_FAMILY_LABELS[hook]}) and scene ${scene} (${AD_SCENE_FAMILY_LABELS[scene]}) spent ${showMoney(c.spend_cents)} ${WINDOW} over ${c.impressions} impressions and ${outcome}.`,
    };
  });
}

const namedConcept = z.object({ hook_family: z.enum(AD_HOOK_FAMILIES), scene_family: z.enum(AD_SCENE_FAMILIES) });

/**
 * The org's per-ad hours since `since`, folded per concept. The hours are read first and only the creatives they
 * name are asked for, so a carrier whose ads never ran costs one query. A preset version that names no hook or scene (older than Q-AD58) has no concept to
 * report under, and `foldConcepts` drops its creatives rather than guess one.
 */
export async function conceptResults(admin: SupabaseClient, orgId: string, since: Date): Promise<ConceptPerformance[]> {
  const rows: AdHourFact[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("ads_ad_spend_hourly").select("creative_id, language, spend_cents, impressions, clicks, leads")
      .eq("org_id", orgId).gte("hour", since.toISOString())
      .order("meta_ad_id").order("hour").range(from, from + PAGE - 1);
    if (error) throw new Error(`ads_ad_spend_hourly: ${error.message}`);
    const got = (data ?? []) as Array<Record<string, unknown>>;
    // bigint columns arrive as strings or numbers depending on size; the fold adds numbers.
    for (const h of got) {
      rows.push({
        creative_id: String(h.creative_id), language: h.language as AdHourFact["language"],
        spend_cents: Number(h.spend_cents), impressions: Number(h.impressions), clicks: Number(h.clicks), leads: Number(h.leads),
      });
    }
    if (got.length < PAGE) break;
  }

  const creatives: Array<{ id: string; preset_version_id: string }> = [];
  for (const ids of chunks([...new Set(rows.map((r) => r.creative_id))])) {
    const { data, error } = await admin.from("ads_creatives").select("id, preset_version_id").eq("org_id", orgId).in("id", ids);
    if (error) throw new Error(`ads_creatives: ${error.message}`);
    creatives.push(...((data ?? []) as Array<{ id: string; preset_version_id: string }>));
  }
  const concepts: Array<{ version_id: string; key: string }> = [];
  for (const ids of chunks([...new Set(creatives.map((c) => c.preset_version_id))])) {
    const { data, error } = await admin.from("ad_concept_preset_versions").select("id, recipe").eq("org_id", orgId).in("id", ids);
    if (error) throw new Error(`ad_concept_preset_versions: ${error.message}`);
    for (const v of (data ?? []) as Array<{ id: string; recipe: unknown }>) {
      const named = namedConcept.safeParse(v.recipe);
      if (named.success) concepts.push({ version_id: v.id, key: `${named.data.hook_family}+${named.data.scene_family}` });
    }
  }
  return foldConcepts(rows, creatives, concepts);
}

function chunks<T>(all: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += IN_CHUNK) out.push(all.slice(i, i + IN_CHUNK));
  return out;
}
