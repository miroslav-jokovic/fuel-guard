import { ADS_SETTINGS_UNSET, CAMPAIGN_EVENTS, CAMPAIGN_STATES, type AdsSettings, type CampaignEvent, type CampaignState } from "@silvicom/shared";
import type { GoldenScenario, TimelineStep, VendorAnswer } from "@silvicom/ads-golden";
import { guardPlatform } from "../modules/ads/guard/guardedPlatform.js";
import { runCampaignStep } from "../modules/ads/orchestrator/runner.js";
import { adsStepDedupKey, orchestratorTick } from "../modules/ads/orchestrator/tick.js";
import { applyCampaignEvent, loadCampaign, type TransitionActor } from "../modules/ads/orchestrator/transitions.js";
import type { CampaignWorkers } from "../modules/ads/orchestrator/workers.js";
import type { PlatformAdapter, PlatformOutcome } from "../modules/ads/platforms/adapter.js";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, T0, type AdsWorld } from "./adsWorld.js";
import { FakeClock } from "./fakeClock.js";
import type { FixtureRow } from "./postgrestFixture.js";

/**
 * The ads golden runner (step 7d; ADS-AGENT-BUILD-WORKFLOW.md §4R, the Orchestrator's L3 row). It runs
 * one `@silvicom/ads-golden` scenario through the REAL `orchestratorTick` and `runCampaignStep` — the
 * machine, the transition ledger, the budget guard, the approvals — over `adsWorld`, the stateful ads
 * database, with only the vendors faked. The scenarios are data in their package; `schema.ts` there
 * says why the runner is here.
 *
 * ── THE QUEUE, AS THE JOBS LEDGER BEHAVES ────────────────────────────────────────────────────────
 * One active job per `dedup_key` (`ads_step:<campaign>:<state>`, `0095_jobs_queue.sql` + the tick's
 * key): a second enqueue of a live key is a conflict. A job whose run throws stays queued and runs
 * again at the next tick — at-least-once delivery, which is what makes a crash a retry. Every job a
 * tick holds runs AT ONCE, harsher than the worker's `KIND_CAPS.ads_step = 2`: a race the cap would
 * hide is a race the scenarios should see.
 *
 * ── THE VENDORS ──────────────────────────────────────────────────────────────────────────────────
 * Each answers from the scenario's script, one entry per call, the last repeating. The fake create is
 * idempotent on the key the runner hands it, as B2's publisher must be (`workers.ts`): a retried create
 * with the same key finds the object the first made. `creates` counts objects, `create` counts calls,
 * so "0 duplicate vendor creates across all crash points" is a number a scenario can state.
 */

export const GOLDEN_OWNER = { id: "11111111-1111-4111-8111-111111111111", name: "Owner" };

export interface GoldenRun {
  states: Record<string, string>;
  last_error: Record<string, string | null>;
  ledger: Record<string, string[]>;
  vendor: { compose: number; create: number; creates: number; launch: number; pause: number };
  /** Distinct keys the compose worker was handed: a retried compose must reuse its key. */
  composeKeys: number;
  /** What each failed job or person step threw, in order. A crash scenario expects some. */
  errors: string[];
  world: AdsWorld;
}

export interface GoldenFailure {
  field: string;
  expected: unknown;
  actual: unknown;
}

const STATES = new Set<string>(CAMPAIGN_STATES);
const EVENTS = new Set<string>(CAMPAIGN_EVENTS);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Every state and event the scenario names must be the machine's (`@silvicom/shared`), checked first. */
export function checkNames(s: GoldenScenario, file: string): void {
  const bad: string[] = [];
  for (const c of s.campaigns) if (!STATES.has(c.state)) bad.push(`campaign ${c.id} starts in unknown state "${c.state}"`);
  for (const [id, st] of Object.entries(s.expect.states)) if (!STATES.has(st)) bad.push(`expect.states.${id} is unknown state "${st}"`);
  for (const step of s.timeline) {
    const move = "person" in step ? step.person : "approver" in step ? step.approver : "platform" in step ? step.platform : null;
    if (move && !EVENTS.has(move.event)) bad.push(`timeline names unknown event "${move.event}"`);
  }
  if (bad.length > 0) throw new Error(`ads golden scenario "${file}": ${bad.join("; ")}`);
}

function settingsFrom(base: AdsSettings, o: { monthly_cap_cents?: number | null; daily_max_cents?: number | null; lifetime_max_cents?: number | null }): AdsSettings {
  const limits = { ...base.limits };
  if (o.monthly_cap_cents !== undefined) limits.monthly_cap_cents = o.monthly_cap_cents === null ? {} : { ...limits.monthly_cap_cents, meta: o.monthly_cap_cents };
  if (o.daily_max_cents !== undefined) limits.daily_max_cents = o.daily_max_cents;
  if (o.lifetime_max_cents !== undefined) limits.lifetime_max_cents = o.lifetime_max_cents;
  return { ...base, limits };
}

/** One script, read one answer per call; the last answer repeats. */
function script(answers: readonly VendorAnswer[]) {
  let n = 0;
  return (): VendorAnswer => answers[Math.min(n++, answers.length - 1)]!;
}

export async function runGolden(s: GoldenScenario, file = s.name): Promise<GoldenRun> {
  checkNames(s, file);
  const clock = new FakeClock(T0);
  let approvalSeq = 0;
  const approvalRow = (a: { campaign: string; daily_budget_cents: number; lifetime_cap_cents: number }, at: string): FixtureRow => ({
    id: `appr-${++approvalSeq}`, org_id: ORG, campaign_id: a.campaign, kind: "launch", withdraws_id: null,
    approved_by: GOLDEN_OWNER.id, approved_by_name: GOLDEN_OWNER.name,
    daily_budget_cents: a.daily_budget_cents, lifetime_cap_cents: a.lifetime_cap_cents, created_at: at,
  });
  const hourOf = (iso?: string): string => iso ?? `${clock.iso().slice(0, 13)}:00:00.000Z`;
  const spendRow = (r: { campaign: string; hour?: string; spend_cents: number }): FixtureRow => ({
    org_id: ORG, campaign_id: r.campaign, hour: hourOf(r.hour), spend_cents: r.spend_cents, impressions: 0, clicks: 0, leads: 0,
  });

  const world = createAdsWorld({
    campaigns: s.campaigns.map((c) => campaign(c.id, c.state as CampaignState, { daily_budget_cents: c.daily_budget_cents, lifetime_cap_cents: c.lifetime_cap_cents })),
    kill: s.kill_switch,
    settings: s.settings === "unset" ? ADS_SETTINGS_UNSET : LIVE_SETTINGS,
    approvals: s.approvals.map((a) => approvalRow(a, T0)),
    spend: s.spend.map(spendRow),
    clock: clock.now,
  });

  const vendor = { compose: 0, create: 0, creates: 0, launch: 0, pause: 0 };
  const created = new Set<string>();
  const composeKeys = new Set<string>();
  const errors: string[] = [];
  // Named `forLaunch`, not after the spend method: budgetGuard.boundary.test.ts reads text, and a
  // script reader called like an adapter's launch would be one more match to explain away.
  const answer = { forCompose: script(s.vendor.compose), forCreate: script(s.vendor.create), forLaunch: script(s.vendor.launch), forPause: script(s.vendor.pause) };

  /** A platform-shaped answer; `ok+kill` presses the switch while the call is in flight. */
  const platformAnswer = (a: VendorAnswer, refs: Record<string, unknown>): PlatformOutcome => {
    if (a === "throw") throw new Error("socket hang up (injected)");
    if (a.startsWith("fail:")) return { ok: false, error_code: a.slice(5) };
    if (a === "ok+kill") world.settings.kill = true;
    return { ok: true, platform_refs: refs };
  };

  const adapter: PlatformAdapter = {
    safe: {
      // A scenario's `account_limit_cents` is the room the account has left: its fake account has spent nothing.
      readAccountHeadroomCents: async () => s.account_limit_cents,
      // A scenario's spend is its `ads_spend_hourly` rows; the account spent nothing outside them.
      readSpendCents: async () => 0,
      pause: async () => {
        vendor.pause += 1;
        return platformAnswer(answer.forPause(), {});
      },
      pauseAd: async () => { throw new Error("ads golden: no scenario retires an ad yet (CQ9b)"); },
    },
    spend: {
      launch: async (call) => {
        vendor.launch += 1;
        return platformAnswer(answer.forLaunch(), { meta_delivery: `d-${call.campaign.campaign_id}` });
      },
      raiseDailyBudget: async () => { throw new Error("ads golden: no scenario raises a budget yet"); },
      changeArea: async () => { throw new Error("ads golden: no scenario changes an area yet"); },
    },
  };

  const workers: CampaignWorkers = {
    compose: s.vendor.compose[0] === "absent" ? null : async (_c, key) => {
      vendor.compose += 1;
      composeKeys.add(key);
      const a = answer.forCompose();
      if (a === "throw") throw new Error("renderer hang up (injected)");
      if (a.startsWith("fail:")) return { ok: false, error: a.slice(5) };
      if (a === "ok+kill") world.settings.kill = true;
      return { ok: true };
    },
    createPaused: s.vendor.create[0] === "absent" ? null : async (c, key) => {
      vendor.create += 1;
      const out = platformAnswer(answer.forCreate(), { meta_campaign: `m-${c.id}` });
      if (out.ok && !created.has(key)) {
        created.add(key);
        vendor.creates += 1;
      }
      return out;
    },
    platform: s.vendor.launch[0] === "absent" ? null : async (_org, conn) => (conn === CONN ? guardPlatform(world.admin, world.now, "meta", adapter) : null),
  };

  const queue = new Map<string, { campaignId: string; state: CampaignState }>();
  let twice = false;

  /** One tick; answers how many jobs it RAN — a retried job runs without being newly queued. */
  const tick = async (): Promise<number> => {
    clock.advance({ minutes: 1 });
    const deliveries = twice ? 2 : 1;
    twice = false;
    await orchestratorTick(world.admin, workers, async (_org, campaignId, state) => {
      const key = adsStepDedupKey(campaignId, state);
      if (queue.has(key)) return "conflict";
      queue.set(key, { campaignId, state });
      return "queued";
    });
    const jobs = [...queue.entries()];
    const runs = jobs.flatMap(([key, job]) =>
      Array.from({ length: deliveries }, () => runCampaignStep({ admin: world.admin, now: world.now, workers }, ORG, job.campaignId, job.state).then(() => key)));
    const done = new Set<string>();
    for (const r2 of await Promise.allSettled(runs)) {
      if (r2.status === "fulfilled") done.add(r2.value);
      else errors.push(message(r2.reason));
    }
    for (const [key] of jobs) if (done.has(key)) queue.delete(key);
    return jobs.length;
  };

  /** A person's (or the platform's) move through `applyCampaignEvent`; a request that dies is pressed once more. */
  const move = async (m: { campaign: string; event: string }, actor: TransitionActor): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const c = await loadCampaign(world.admin, ORG, m.campaign);
        if (!c) throw new Error(`ads golden: campaign ${m.campaign} not found`);
        await applyCampaignEvent(world.admin, c, { event: m.event as CampaignEvent, actor }, world.now().toISOString());
        return;
      } catch (e) {
        errors.push(message(e));
      }
    }
  };

  const steps: Record<string, (step: TimelineStep) => Promise<void>> = {
    tick: async (st) => { for (let i = 0; i < (st as { tick: number }).tick; i += 1) await tick(); },
    // Until a tick runs no job (at most 10): nothing queued anew, and no failed job waiting to retry.
    settle: async () => {
      for (let i = 0; i < 10; i += 1) if ((await tick()) === 0) return;
    },
    person: (st) => move((st as { person: { campaign: string; event: string } }).person, { kind: "person", ...GOLDEN_OWNER }),
    approver: (st) => move((st as { approver: { campaign: string; event: string } }).approver, { kind: "approver", ...GOLDEN_OWNER }),
    platform: (st) => move((st as { platform: { campaign: string; event: string } }).platform, { kind: "platform", name: "Meta" }),
    approve: async (st) => { world.approvals.push(approvalRow((st as { approve: Parameters<typeof approvalRow>[0] }).approve, world.now().toISOString())); },
    kill_switch: async (st) => { world.settings.kill = (st as { kill_switch: boolean }).kill_switch; },
    settings: async (st) => { world.saveSettings(settingsFrom(world.settings.value, (st as { settings: Parameters<typeof settingsFrom>[1] }).settings)); },
    spend: async (st) => { world.spend.push(spendRow((st as { spend: Parameters<typeof spendRow>[0] }).spend)); },
    crash: async (st) => {
      const c = (st as { crash: { table: "ads_campaigns" | "ads_actions"; nth: number } }).crash;
      world.crashOnWrite(c.table, c.nth);
    },
    deliver_twice: async () => { twice = true; },
    advance: async (st) => { clock.advance((st as { advance: { minutes?: number; hours?: number; days?: number } }).advance); },
  };

  for (const step of s.timeline) await steps[Object.keys(step)[0]!]!(step);

  const ids = s.campaigns.map((c) => c.id);
  return {
    states: Object.fromEntries(ids.map((id) => [id, world.byId(id).state])),
    last_error: Object.fromEntries(ids.map((id) => [id, (world.byId(id).last_error as string | null) ?? null])),
    ledger: Object.fromEntries(ids.map((id) => [id, world.actions.filter((a) => a.campaign_id === id).map(ledgerLine)])),
    vendor,
    composeKeys: composeKeys.size,
    errors,
    world,
  };
}

/** One `ads_actions` row as a scenario writes it (`@silvicom/ads-golden` schema, `expect.ledger`). */
export function ledgerLine(a: FixtureRow): string {
  if (a.kind !== "transition") return `${String(a.kind)} ${String(a.status)}`;
  const r = (a.request ?? {}) as { from?: string; event?: string; to?: string };
  return a.status === "refused" ? `${r.from} -${r.event}- refused` : `${r.from} -${r.event}-> ${r.to} ${String(a.status)}`;
}

/** What the scenario expected against what happened; empty = it passed. */
export function compareGolden(s: GoldenScenario, run: GoldenRun): GoldenFailure[] {
  const out: GoldenFailure[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const [id, st] of Object.entries(s.expect.states)) if (run.states[id] !== st) out.push({ field: `states.${id}`, expected: st, actual: run.states[id] });
  for (const [id, err] of Object.entries(s.expect.last_error)) if (run.last_error[id] !== err) out.push({ field: `last_error.${id}`, expected: err, actual: run.last_error[id] });
  for (const [id, lines] of Object.entries(s.expect.ledger)) if (!same(run.ledger[id], lines)) out.push({ field: `ledger.${id}`, expected: lines, actual: run.ledger[id] });
  for (const [k, n] of Object.entries(s.expect.vendor)) {
    const got = run.vendor[k as keyof GoldenRun["vendor"]];
    if (got !== n) out.push({ field: `vendor.${k}`, expected: n, actual: got });
  }
  return out;
}
