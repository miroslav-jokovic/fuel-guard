import { CAMPAIGN_STATES, type AdsSettings, type CampaignState } from "@silvicom/shared";
import type { MonitorScenario, MonitorStep } from "@silvicom/ads-golden";
import { checkConnection } from "../modules/ads/monitor/checks.js";
import { pullConnectionInsights } from "../modules/ads/monitor/insightsPull.js";
import { localOf } from "../modules/ads/monitor/localHours.js";
import { reconcileConnection } from "../modules/ads/monitor/reconcile.js";
import { resetGraphThrottles } from "../modules/ads/platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID } from "../modules/ads/platforms/registry.js";
import type { FakeMeta } from "../modules/ads/platforms/simulator/fakeMeta.js";
import { forgetAllHours, forgetHour, plantFrequency, plantHour } from "../modules/ads/platforms/simulator/fakeMetaInsightsHourly.js";
import type { GoldenFailure } from "./adsGolden.js";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type AdsWorld } from "./adsWorld.js";
import { FakeClock } from "./fakeClock.js";
import { testEnv } from "./testEnv.js";

/**
 * The monitor's golden runner (ADS-AGENT-BUILD-WORKFLOW.md §4R, the Monitor's L3 row). It runs one monitor
 * scenario through the REAL pull, checks and reconcile, over `adsWorld` and the simulator on real HTTP, with
 * Meta's side planted as the scenario says. Beside `adsGolden.ts`, not inside it: `monitorSchema.ts` says why.
 *
 * ── THE JOBS, AS THEIR HANDLERS RUN THEM ─────────────────────────────────────────────────────────
 * `hourly_job` is `queue/handlers/adsInsights.ts`: the pull, then the checks in the zone the pull read.
 * `daily_reconcile` is `queue/handlers/adsReconcile.ts`: `reconcileConnection`, whose own first act is the 28-day
 * re-read. So a scenario's spend reaches `ads_spend_hourly` the way production's does, through Meta's hours and
 * the pull, and never straight into the table (`thirtyDays.test.ts` writes it straight in; this closes that).
 *
 * ── WHAT EVERY RUN MUST ALSO SHOW ────────────────────────────────────────────────────────────────
 * `compareMonitor` holds two things no scenario states, because they hold for all of them: nothing was written
 * to Meta (the monitor decides, the orchestrator's pausing step acts; reconcile never adopts), and a campaign
 * moved only by a pause the scenario names.
 */

const STATES = new Set<string>(CAMPAIGN_STATES);

export interface MonitorRun {
  states: Record<string, string>;
  pauses: string[];
  flags: string[];
  bell: string[];
  /** Every failure a job reported, each named by its job and run. */
  failures: string[];
  /** Writes that reached Meta. Always an error here: the monitor never writes there. */
  metaWrites: number;
  /** Each campaign's transitions: the only ones allowed are its pauses. */
  moves: Record<string, number>;
  world: AdsWorld;
}

function settingsOf(s: MonitorScenario): AdsSettings {
  const { monthly_cap_cents, ...auto } = s.settings;
  return {
    ...LIVE_SETTINGS,
    limits: { ...LIVE_SETTINGS.limits, monthly_cap_cents: { simulator: monthly_cap_cents } },
    auto_pause: { ...auto, pause_when_filled: true },
  };
}

/** Our Meta objects for one campaign, agreeing with its row (`adsReconcile.ts`'s rule for each state). */
function seedOnMeta(fake: FakeMeta, c: MonitorScenario["campaigns"][number], n: number) {
  const metaCampaign = String(690_000_000_000 + n);
  const metaAdset = String(691_000_000_000 + n);
  fake.campaigns.set(metaCampaign, {
    id: metaCampaign, account_id: SIMULATOR_ACCOUNT_ID, name: `S360|SIM|campaign|recruiting_opening|op-${n}@v1|ALL|20261102|ab12cd3${n % 10}`,
    objective: "OUTCOME_LEADS", status: c.state === "live" || c.state === "launching" || c.state === "pausing" ? "ACTIVE" : "PAUSED",
    special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"],
    spend_cap: String(c.lifetime_cap_cents ?? 50_000), daily_budget: null,
  });
  fake.adsets.set(metaAdset, {
    id: metaAdset, account_id: SIMULATOR_ACCOUNT_ID, campaign_id: metaCampaign, name: `S360|SIM|adset|${c.id}`, status: "ACTIVE",
    daily_budget: String(c.daily_budget_cents ?? 5_000), billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION",
    destination_type: null, promoted_object: null, targeting: {},
    ...(c.stage === "none" ? {} : { learning_stage_info: { status: c.stage } }),
  });
  if (c.frequency !== undefined) plantFrequency(fake, metaAdset, c.frequency);
  return { metaCampaign, metaAdset };
}

export async function runMonitorGolden(s: MonitorScenario, fake: FakeMeta, file = s.name): Promise<MonitorRun> {
  const unknown = [...s.campaigns.map((c) => c.state), ...Object.values(s.expect.states)].filter((st) => !STATES.has(st));
  if (unknown.length > 0) throw new Error(`ads monitor scenario "${file}": unknown state ${unknown.join(", ")}`);

  // The simulator is one process-wide fake; a scenario starts from an empty account.
  forgetAllHours(fake);
  fake.campaigns.clear();
  fake.adsets.clear();
  fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.month_spend_cents = 0;
  fake.requests.length = 0;

  const clock = new FakeClock(s.start);
  const onMeta = new Map(s.campaigns.map((c, i) => [c.id, seedOnMeta(fake, c, i + 1)]));
  const meta = (id: string) => onMeta.get(id)!;
  const world = createAdsWorld({
    campaigns: s.campaigns.map((c) => campaign(c.id, c.state as CampaignState, {
      daily_budget_cents: c.daily_budget_cents, lifetime_cap_cents: c.lifetime_cap_cents,
      platform_refs: { meta_campaign_id: meta(c.id).metaCampaign, meta_adset_id: meta(c.id).metaAdset },
    })),
    settings: settingsOf(s),
    connections: [{ id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" }],
    clock: clock.now,
  });
  const deps = { env: testEnv(), processEnv: { NODE_ENV: "test" }, admin: world.admin, now: world.now };

  const out: Pick<MonitorRun, "pauses" | "flags" | "failures"> = { pauses: [], flags: [], failures: [] };
  const foreign = new Map<string, string>();
  const zone = fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.timezone_name ?? "America/Chicago";
  const today = () => localOf(clock.now(), zone).day;
  let hourly = 0;
  let reconciles = 0;

  const hourlyJob = async () => {
    hourly += 1;
    resetGraphThrottles();
    const pull = await pullConnectionInsights(deps, ORG, CONN);
    const checks = pull.zone ? await checkConnection(deps, ORG, CONN, pull.zone) : null;
    for (const f of [...pull.failures, ...(checks?.failures ?? [])]) out.failures.push(`hourly ${hourly}: ${f.campaign_id ?? "-"} ${f.reason}`);
    if (!checks) out.failures.push(`hourly ${hourly}: the pull read no zone`);
    for (const p of checks?.paused ?? []) {
      // From the ledger, not the job's answer: "each pause ledgered with its rule" is what is being shown.
      const row = world.transitions(p.campaign_id).at(-1)!;
      const said = /auto-pause (\w+): measured (\S+) > (\S+)/.exec(String(row.cause));
      out.pauses.push(`run ${hourly}: ${p.campaign_id} ${said?.[1]} ${said?.[2]} > ${said?.[3]}`);
    }
  };

  const dailyReconcile = async () => {
    reconciles += 1;
    resetGraphThrottles();
    const before = world.actions.length;
    const r = await reconcileConnection(deps, ORG, CONN);
    for (const f of r.failures) out.failures.push(`reconcile ${reconciles}: ${f.campaign_id ?? "-"} ${f.reason}`);
    for (const a of world.actions.slice(before).filter((x) => x.kind === "external_change")) {
      const q = a.request as { level: string; meta_id: string; field: string; ours: unknown; theirs: unknown; severity: string };
      out.flags.push(`run ${reconciles}: ${String(a.campaign_id ?? foreign.get(q.meta_id))} ${q.level} ${q.field} ${String(q.ours ?? "none")} -> ${String(q.theirs ?? "none")} ${q.severity}`);
    }
  };

  /** One edit as a person in Ads Manager makes it; the schema allows one per step. */
  const adsManager = (e: Extract<MonitorStep, { ads_manager: unknown }>["ads_manager"]) => {
    const { metaCampaign, metaAdset } = meta(e.campaign);
    if (e.status) fake.externalStatusChange(metaCampaign, e.status);
    if (e.adset_status) fake.adsets.get(metaAdset)!.status = e.adset_status;
    // Meta's ad set always holds a budget in the fake's type; removed reads back as absent, as `readObject` expects.
    if (e.daily_budget_cents !== undefined) Object.assign(fake.adsets.get(metaAdset)!, { daily_budget: e.daily_budget_cents === null ? null : String(e.daily_budget_cents) });
    if (e.spend_cap_cents !== undefined) fake.campaigns.get(metaCampaign)!.spend_cap = e.spend_cap_cents === null ? null : String(e.spend_cap_cents);
    if (e.remove === "campaign") fake.campaigns.delete(metaCampaign);
    if (e.remove === "adset") fake.adsets.delete(metaAdset);
  };

  for (const step of s.timeline) {
    if ("meta_reports" in step) {
      const r = step.meta_reports;
      plantHour(fake, meta(r.campaign).metaCampaign, r.day ?? today(), r.hour, { spend_cents: r.spend_cents, leads: r.leads, impressions: 100, clicks: 1 });
    } else if ("meta_forgets" in step) {
      const r = step.meta_forgets;
      forgetHour(fake, meta(r.campaign).metaCampaign, r.day ?? today(), r.hour);
    } else if ("account_month" in step) {
      fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.month_spend_cents = step.account_month;
    } else if ("stage" in step) {
      const set = fake.adsets.get(meta(step.stage.campaign).metaAdset)!;
      if (step.stage.stage === "none") delete set.learning_stage_info;
      else set.learning_stage_info = { status: step.stage.stage };
    } else if ("frequency" in step) {
      plantFrequency(fake, meta(step.frequency.campaign).metaAdset, step.frequency.value);
    } else if ("ads_manager" in step) {
      adsManager(step.ads_manager);
    } else if ("foreign_campaign" in step) {
      const f = step.foreign_campaign;
      const metaId = String(699_000_000_000 + foreign.size + 1);
      foreign.set(metaId, f.id);
      fake.campaigns.set(metaId, {
        id: metaId, account_id: SIMULATOR_ACCOUNT_ID, objective: null, status: f.status, special_ad_categories: [], special_ad_category_country: null, spend_cap: null, daily_budget: null,
        name: f.named_as_ours ? `S360|SIM|campaign|recruiting_opening|op-lost@v1|ALL|20261102|ab12cd39` : "Spring push (made by hand)",
      });
    } else if ("hourly_job" in step) {
      await hourlyJob();
    } else if ("daily_reconcile" in step) {
      await dailyReconcile();
    } else {
      clock.advance(step.advance);
    }
  }

  const ids = s.campaigns.map((c) => c.id);
  return {
    ...out,
    states: Object.fromEntries(ids.map((id) => [id, world.byId(id).state])),
    bell: world.bell.map((b) => `${b.category} ${b.severity}`),
    metaWrites: fake.requests.filter((q) => q.method === "POST").length,
    moves: Object.fromEntries(ids.map((id) => [id, world.transitions(id).length])),
    world,
  };
}

/** What the scenario expected against what happened; empty = it passed. Lists compare as sets of lines, repeats kept. */
export function compareMonitor(s: MonitorScenario, run: MonitorRun): GoldenFailure[] {
  const out: GoldenFailure[] = [];
  const sorted = (l: readonly string[]) => [...l].sort();
  const sameList = (field: "pauses" | "flags" | "bell" | "failures") => {
    if (JSON.stringify(sorted(s.expect[field])) !== JSON.stringify(sorted(run[field]))) out.push({ field, expected: sorted(s.expect[field]), actual: sorted(run[field]) });
  };
  for (const [id, st] of Object.entries(s.expect.states)) if (run.states[id] !== st) out.push({ field: `states.${id}`, expected: st, actual: run.states[id] });
  sameList("pauses");
  sameList("flags");
  sameList("bell");
  sameList("failures");
  if (run.metaWrites !== 0) out.push({ field: "metaWrites", expected: 0, actual: run.metaWrites });
  for (const [id, moves] of Object.entries(run.moves)) {
    const paused = s.expect.pauses.filter((l) => l.split(" ")[2] === id).length;
    if (moves !== paused) out.push({ field: `moves.${id}`, expected: paused, actual: moves });
  }
  return out;
}
