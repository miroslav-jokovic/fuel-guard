import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ORG_TIMEZONE, wallClockInZone, wallClockToUtc, type LeadOutcome, type LeadOutcomes } from "@silvicom/shared";

/**
 * Recruiting's `LeadOutcomes` (Q-AD34, ruled 2026-11-05): which stages each ad lead reached and when, read
 * from recruiting's own rows. Ads is handed this at the composition root and never reads these tables
 * (D-AD17). The stages and why each is what it is: `packages/shared/src/ads/leadOutcomes.ts`. The sources:
 *
 *   arrived                `recruiting_leads.platform_created_at`, else `received_at`; only leads with a
 *                          `campaign_ref` (an ad's lead: `leadFromPlatform` sets it, a typed-in lead has none)
 *   contacted              the earliest `recruiting_contacts.contacted_at` (append-only, D-LS6)
 *   converted              `lead_conversions.created_at` (one per lead, `unique (lead_id)`)
 *   applied                the earliest `driver_applications.certified_at` of the applicant it became
 *   hired                  that applicant's `drivers.hire_date`, when the status has left `applicant` and the
 *                          date is not before the lead arrived (see below)
 *   lost_after_conversion  the newest `applicant_dispositions` row of an applicant who was not hired
 *
 * ── WHY "HIRED" IS hire_date, NOT status = 'active' (checked 2026-11-05) ────────────────────────────
 * `hire_applicant` (0218) is the only door from `applicant` to `active` (0386 enforces it) and it is what
 * stamps `hire_date`. A driver hired and later terminated or made inactive — McLeod's retirement sweep does
 * that every day (ROSTER-LIFECYCLE-PLAN; memory roster-lifecycle-position) — was still hired, and reading
 * `status = 'active'` would quietly un-hire them from their cohort. So: `hire_date` set and the status no
 * longer `applicant`. A lead converted onto a driver already on the roster (a rehire merged into an old row)
 * carries that row's OLD hire date; a hire date before the lead arrived is not this lead's hire.
 *
 * ── EVERY READ IS ORG-SCOPED AND PAGED ─────────────────────────────────────────────────────────────
 * The service role bypasses RLS, so each query filters `org_id` itself. Each is paged past PostgREST's
 * 1,000-row cap (memory postgrest-caps-every-response-at-1000), and an `.in()` list is cut into chunks of
 * 100 ids so a big cohort never overflows Node's request-header limit (memory in-list-overflows-node22).
 */

const PAGE = 1000;
const CHUNK = 100;

export function recruitingLeadOutcomes(admin: SupabaseClient): LeadOutcomes {
  return { outcomesSince: (orgId, since) => readLeadOutcomes(admin, orgId, since) };
}

export type Rows = Array<Record<string, unknown>>;

/** Every row of one query, page by page; `build` makes a fresh query for each page (ordered, so pages are stable). */
export async function allPages(label: string, build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<Rows> {
  const out: Rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const got = (data ?? []) as Rows;
    out.push(...got);
    if (got.length < PAGE) return out;
  }
}

/** `allPages` over an id list cut into chunks of `CHUNK`. */
export async function byIds(label: string, ids: readonly string[], build: (chunk: string[]) => ReturnType<Parameters<typeof allPages>[1]>): Promise<Rows> {
  const out: Rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    out.push(...(await allPages(label, () => build(chunk))));
  }
  return out;
}

const earlier = (a: string | undefined, b: string): string => (a === undefined || Date.parse(b) < Date.parse(a) ? b : a);

/** A calendar day as the instant it starts in the carrier's zone (a day is not an instant: memory a-calendar-day-is-not-an-instant). */
function dayStart(day: string): string {
  const [year, month, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(wallClockToUtc({ year, month, day: d, hour: 0, minute: 0, second: 0 }, DEFAULT_ORG_TIMEZONE)).toISOString();
}

function localDay(instant: string): string {
  const wc = wallClockInZone(new Date(instant), DEFAULT_ORG_TIMEZONE);
  return `${wc.year}-${String(wc.month).padStart(2, "0")}-${String(wc.day).padStart(2, "0")}`;
}

export async function readLeadOutcomes(admin: SupabaseClient, orgId: string, since: string): Promise<LeadOutcome[]> {
  // Received is never before the platform's own time, so `received_at >= since` reads every lead that can
  // have ARRIVED since; the arrival itself is filtered below, on the platform's time when there is one.
  const leadRows = await allPages("recruiting_leads", () => admin.from("recruiting_leads")
    .select("id, channel, external_ref, campaign_ref, platform_created_at, received_at")
    .eq("org_id", orgId).not("campaign_ref", "is", null).gte("received_at", since).order("id"));
  const leads = leadRows
    .map((l) => ({ id: String(l.id), provider: String(l.channel), ref: String(l.external_ref), campaign: String(l.campaign_ref), arrived: new Date(String(l.platform_created_at ?? l.received_at)).toISOString() }))
    .filter((l) => Date.parse(l.arrived) >= Date.parse(since));
  if (leads.length === 0) return [];
  const leadIds = leads.map((l) => l.id);

  const contacted = new Map<string, string>();
  for (const c of await byIds("recruiting_contacts", leadIds, (ids) => admin.from("recruiting_contacts")
    .select("lead_id, contacted_at").eq("org_id", orgId).in("lead_id", ids).order("id"))) {
    contacted.set(String(c.lead_id), earlier(contacted.get(String(c.lead_id)), new Date(String(c.contacted_at)).toISOString()));
  }

  const conversions = new Map<string, { driver: string; at: string }>();
  for (const c of await byIds("lead_conversions", leadIds, (ids) => admin.from("lead_conversions")
    .select("lead_id, driver_id, created_at").eq("org_id", orgId).in("lead_id", ids).order("id"))) {
    conversions.set(String(c.lead_id), { driver: String(c.driver_id), at: new Date(String(c.created_at)).toISOString() });
  }
  const driverIds = [...new Set([...conversions.values()].map((c) => c.driver))];

  const applied = new Map<string, string>();
  const drivers = new Map<string, { status: string; hire_date: string | null }>();
  const lost = new Map<string, { at: string; created: string }>();
  if (driverIds.length > 0) {
    for (const a of await byIds("driver_applications", driverIds, (ids) => admin.from("driver_applications")
      .select("driver_id, certified_at").eq("org_id", orgId).in("driver_id", ids).order("id"))) {
      applied.set(String(a.driver_id), earlier(applied.get(String(a.driver_id)), new Date(String(a.certified_at)).toISOString()));
    }
    for (const d of await byIds("drivers", driverIds, (ids) => admin.from("drivers")
      .select("id, status, hire_date").eq("org_id", orgId).in("id", ids).order("id"))) {
      drivers.set(String(d.id), { status: String(d.status), hire_date: (d.hire_date as string | null) ?? null });
    }
    // Append-only, newest first is the standing decision (0238: a correction is a new row).
    for (const d of await byIds("applicant_dispositions", driverIds, (ids) => admin.from("applicant_dispositions")
      .select("driver_id, decided_on, created_at").eq("org_id", orgId).in("driver_id", ids).order("id"))) {
      const prev = lost.get(String(d.driver_id));
      const created = new Date(String(d.created_at)).toISOString();
      if (!prev || Date.parse(created) > Date.parse(prev.created)) lost.set(String(d.driver_id), { at: dayStart(String(d.decided_on)), created });
    }
  }

  return leads.map((l) => {
    const reached: LeadOutcome["reached"] = {};
    const contact = contacted.get(l.id);
    if (contact) reached.contacted = contact;
    const conv = conversions.get(l.id);
    if (conv) {
      reached.converted = conv.at;
      const app = applied.get(conv.driver);
      if (app) reached.applied = app;
      const d = drivers.get(conv.driver);
      const hired = d && d.hire_date && d.status !== "applicant" && d.hire_date >= localDay(l.arrived);
      if (hired) reached.hired = dayStart(d.hire_date!);
      const end = lost.get(conv.driver);
      if (!hired && end) reached.lost_after_conversion = end.at;
    }
    return { lead_id: l.id, provider: l.provider, platform_lead_ref: l.ref, campaign_id: l.campaign, arrived_at: l.arrived, reached };
  });
}
