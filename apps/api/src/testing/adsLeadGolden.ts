import { HIRING_PROFILE_V1, type LeadProjection } from "@silvicom/shared";
import type { LeadScenario, LeadStep } from "@silvicom/ads-golden";
import { backfillConnectionLeads, catchUpSince } from "../modules/ads/leads/backfill.js";
import { fetchWebhookLead, LeadFetchError } from "../modules/ads/leads/leadFetch.js";
import { adsLeadFetchDedupKey, receiveLeadgenDelivery } from "../modules/ads/leads/leadgenWebhook.js";
import { resetGraphThrottles } from "../modules/ads/platforms/meta/graphClient.js";
import { SIMULATOR_PAGE_ID } from "../modules/ads/platforms/registry.js";
import type { FakeMeta } from "../modules/ads/platforms/simulator/fakeMeta.js";
import type { FakeLead } from "../modules/ads/platforms/simulator/fakeMetaLeads.js";
import { recruitingLeadSink } from "../modules/recruiting/index.js";
import type { GoldenFailure } from "./adsGolden.js";
import { FakeClock } from "./fakeClock.js";
import { postgrestFixture, type FixtureRow } from "./postgrestFixture.js";
import { createSupabaseRecorder, type RecordedQuery, type SupabaseRecorder } from "./supabaseRecorder.js";
import { testEnv } from "./testEnv.js";

/**
 * The lead intake golden runner (ADS-AGENT-BUILD-WORKFLOW.md §4R, Lead intake's L3 row). It runs one scenario
 * through the REAL receiver, fetch, backfill, sink, projection and verdicts, with Meta on the simulator over HTTP.
 *
 * ── THE ONE IMITATION: `ingest_lead` ─────────────────────────────────────────────────────────────
 * The recorder cannot run SQL, so `ingest_lead` is a map keyed as its unique index is: (org, channel, ref). It
 * answers `new` once and `duplicate` after. So these scenarios prove the two roads and everything up to the store's
 * door; `supabase/tests/recruiting-lead-functions.test.mjs` proves the function behind it (`leadSchema.ts` header).
 *
 * ── THE JOBS, AS THEIR HANDLERS RUN THEM ─────────────────────────────────────────────────────────
 * `queue/handlers/adsLeadFetch.ts` and `adsLeadsBackfill.ts` take the wall clock and the jobs ledger, so their few
 * lines are done here on the scenario's clock: one queued job per dedup key, a job that throws stays queued (the
 * queue's retry), and a backfill reaches back with `catchUpSince` to the last run that finished with nothing missing.
 */

const ORG = "00000000-0000-4000-8000-0000000000a1";
const CONN = "00000000-0000-4000-8000-0000000000c1";
const CAMP = "00000000-0000-4000-8000-00000000aa01";
const OPENING = "00000000-0000-4000-8000-00000000bb01";
const PROFILE_VERSION = "00000000-0000-4000-8000-00000000cc01";
const START = "2026-11-03T15:00:00.000Z";
/** Everything a lead may touch. Anything else written is text in a form reaching an action. */
const LEAD_WRITES = new Set(["lead_match_verdicts"]);
const LEAD_RPCS = new Set(["ingest_lead", "emit_notification"]);

export interface LeadRun {
  /** Lead → the road of every row stored for it. Exactly one each is the bar. */
  stored: Record<string, string[]>;
  accepted: number;
  refused: number;
  failures: string[];
  rung: string[];
  /** `ads_token_expiring` bells, by dedupe key: one per connection per day (`connectionAlerts.ts`). */
  connectionBells: string[];
  waiting: string[];
  /** What the store was handed, by lead. */
  handed: Record<string, LeadProjection>;
  verdicts: Record<string, Record<string, string>>;
  /** Verdict rows written, by lead; each requirement once. */
  verdictRows: Record<string, number>;
  /** Tables written and functions called that a lead has no business touching. */
  strayWrites: string[];
  metaWrites: number;
  rec: SupabaseRecorder;
}

export async function runLeadGolden(s: LeadScenario, fake: FakeMeta): Promise<LeadRun> {
  // The simulator is one process-wide fake; a scenario starts with no leads, three new forms and the Page subscribed.
  fake.leads.leads.length = 0;
  fake.requests.length = 0;
  fake.webhooks.subscribe({ id: SIMULATOR_PAGE_ID, tasks: ["MODERATE"] }, { subscribed_fields: "leadgen" });
  const newForm = () => (fake.forms.create(SIMULATOR_PAGE_ID, {
    name: `F-${Math.random()}`, locale: "EN_US", questions: JSON.stringify([{ type: "FULL_NAME", key: "full_name" }]),
    privacy_policy: JSON.stringify({ url: "https://silvicom.test/privacy" }),
  }).body as { id: string }).id;
  const forms = { en: newForm(), es: newForm(), other: newForm() };
  const formLabel = new Map(Object.entries(forms).map(([k, v]) => [v, k]));

  const clock = new FakeClock(START);
  const onMeta = new Map<string, FakeLead>();
  const labelOf = (ref: string): string => [...onMeta].find(([, l]) => l.id === ref)?.[0] ?? ref;

  let road: "webhook" | "backfill" = "webhook";
  const rows = new Map<string, { id: string; roads: string[]; projection: LeadProjection }>();
  const faults: Array<"fail" | "answer_lost"> = [];
  const verdictRows: FixtureRow[] = [];
  const rung = new Set<string>();
  const connectionBells = new Set<string>();

  const ingest = (args: { p_org: string; p_lead: LeadProjection }) => {
    const fault = faults.shift();
    if (fault === "fail") return { error: { message: "connection terminated (injected)" } };
    const key = `${args.p_org}|${args.p_lead.channel}|${args.p_lead.external_ref}`;
    const row = rows.get(key);
    const stored = row ? "duplicate" : "new";
    const held = row ?? { id: `50000000-0000-4000-8000-${String(rows.size + 1).padStart(12, "0")}`, roads: [road], projection: args.p_lead };
    rows.set(key, held);
    if (fault === "answer_lost") return { error: { message: "connection terminated (injected)" } };
    return { lead_id: held.id, stored, matches: { leads: [], drivers: [] } };
  };

  const rec = createSupabaseRecorder({
    tables: {
      ads_platform_connections: postgrestFixture([{ id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, page_token_sealed: null, status: "connected" }]),
      ads_campaigns: postgrestFixture([{ id: CAMP, org_id: ORG, connection_id: CONN, brief_source: "recruiting_opening", brief_ref: `${OPENING}@v2`, platform_refs: { meta_form_ids: { en: forms.en, es: forms.es } } }]),
      recruiting_opening_versions: postgrestFixture([{ org_id: ORG, opening_id: OPENING, version: 2, profile_version_id: PROFILE_VERSION }]),
      hiring_profile_versions: postgrestFixture([{ org_id: ORG, id: PROFILE_VERSION, requirements: HIRING_PROFILE_V1 }]),
      lead_match_verdicts: (q: RecordedQuery) => {
        if (q.write?.method !== "insert") return postgrestFixture(verdictRows)(q);
        verdictRows.push(...([] as FixtureRow[]).concat(q.write.payload as FixtureRow[]).map((r, i) => ({ id: `v-${verdictRows.length + i}`, ...r })));
        return { data: q.write.payload };
      },
      memberships: postgrestFixture([{ org_id: ORG, user_id: "u-admin", role: "admin", suspended_at: null }]),
      ads_settings_versions: [],
      driver_app_features: [],
    },
    rpc: (fn, args) => {
      if (fn === "ingest_lead") return ingest(args as { p_org: string; p_lead: LeadProjection });
      if (fn !== "emit_notification") return null;
      const key = (args as { p_dedupe_key?: string | null }).p_dedupe_key ?? "";
      if (key.startsWith("lead_new:")) rung.add(key.slice("lead_new:".length));
      if (key.startsWith("ads_token_expiring:")) connectionBells.add(key);
      return `ntf-${rung.size}`;
    },
  });
  const admin = rec.client as never;
  const sink = recruitingLeadSink(admin, async () => ["u-dana"], clock.now);
  const deps = { admin, sink, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: clock.now };

  const out = { accepted: 0, refused: 0, failures: [] as string[] };
  const queue = new Map<string, { leadgenId: string; formId: string }>();
  const enqueue = async (orgId: string, payload: { leadgenId: string; formId: string }): Promise<"queued" | "conflict"> => {
    const key = adsLeadFetchDedupKey(orgId, payload.leadgenId);
    if (queue.has(key)) return "conflict";
    queue.set(key, payload);
    return "queued";
  };

  const deliver = async (labels: string[], forge: boolean) => {
    const leads = labels.map((l) => onMeta.get(l)!);
    const d = fake.webhooks.leadgenDelivery(SIMULATOR_PAGE_ID, leads, { forge, at: clock.now() })!;
    const r = await receiveLeadgenDelivery({ env: { META_APP_SECRET: fake.webhooks.appSecret }, admin, enqueue }, Buffer.from(d.body), d.signature);
    if (r.status === 200) out.accepted += 1;
    else if (r.status === 401) out.refused += 1;
    else out.failures.push(`delivery: answered ${r.status}`);
  };

  let jobRuns = 0;
  const runJobs = async () => {
    jobRuns += 1;
    road = "webhook";
    for (const [key, job] of [...queue]) {
      resetGraphThrottles();
      try {
        await fetchWebhookLead(deps, ORG, job);
        queue.delete(key);
      } catch (e) {
        out.failures.push(`jobs ${jobRuns}: ${labelOf(job.leadgenId)} ${e instanceof LeadFetchError ? e.reason : String(e)}`);
      }
    }
  };

  let backfills = 0;
  let lastDone: Date | null = null;
  const runBackfill = async () => {
    backfills += 1;
    road = "backfill";
    resetGraphThrottles();
    const started = clock.now();
    const r = await backfillConnectionLeads(deps, ORG, CONN, { since: catchUpSince(started, lastDone) });
    for (const f of r.failures) out.failures.push(`backfill ${backfills}: ${f.lead_id ? labelOf(f.lead_id) : formLabel.get(f.form_id ?? "") ?? "-"} ${f.reason}`);
    if (r.failures.length === 0) lastDone = started;
  };

  const run: Record<string, (step: LeadStep) => Promise<void> | void> = {
    submit: (st) => {
      const { lead, form, answers } = (st as Extract<LeadStep, { submit: unknown }>).submit;
      onMeta.set(lead, fake.leads.submit(forms[form], answers, clock.now()));
    },
    webhook: (st) => deliver((st as { webhook: string[] }).webhook, false),
    forged_webhook: (st) => deliver((st as { forged_webhook: string[] }).forged_webhook, true),
    jobs: runJobs,
    backfill: runBackfill,
    meta_refuses: (st) => {
      const { reads, listings } = (st as { meta_refuses: { reads?: number; listings?: number } }).meta_refuses;
      if (reads) fake.inject("GET", /^\d+$/, { kind: "token_expired" }, reads);
      if (listings) fake.inject("GET", /^\d+\/leads$/, { kind: "token_expired" }, listings);
    },
    store_fails: (st) => { faults.push(...Array<"fail">((st as { store_fails: number }).store_fails).fill("fail")); },
    store_answer_lost: (st) => { faults.push(...Array<"answer_lost">((st as { store_answer_lost: number }).store_answer_lost).fill("answer_lost")); },
    advance: (st) => { clock.advance((st as { advance: { minutes?: number; hours?: number; days?: number } }).advance); },
  };
  for (const step of s.timeline) await run[Object.keys(step)[0]!]!(step);

  const byId = new Map([...rows.values()].map((r) => [r.id, r]));
  const label = (r: { projection: LeadProjection }) => labelOf(r.projection.external_ref ?? "");
  const verdicts: LeadRun["verdicts"] = {};
  const counts: LeadRun["verdictRows"] = {};
  for (const v of verdictRows) {
    const l = label(byId.get(String(v.lead_id))!);
    (verdicts[l] ??= {})[String(v.requirement)] = String(v.verdict);
    counts[l] = (counts[l] ?? 0) + 1;
  }
  return {
    ...out,
    stored: Object.fromEntries([...rows.values()].map((r) => [label(r), r.roads])),
    rung: [...rung].map((id) => label(byId.get(id)!)),
    connectionBells: [...connectionBells],
    waiting: [...queue.values()].map((j) => labelOf(j.leadgenId)),
    handed: Object.fromEntries([...rows.values()].map((r) => [label(r), r.projection])),
    verdicts,
    verdictRows: counts,
    strayWrites: [
      // Marking the connection `failing` on a refused token is the alert's half (connectionAlerts.ts), stated by
      // `connection_bells`; any other write to it is still stray.
      ...rec.writes().filter((q) => !(q.table === "ads_platform_connections" && (q.write?.payload as { status?: string } | null)?.status === "failing"))
        .map((q) => q.table).filter((t) => !LEAD_WRITES.has(t)),
      ...rec.rpcs().map((c) => c.fn).filter((fn) => !LEAD_RPCS.has(fn)),
    ],
    metaWrites: fake.requests.filter((q) => q.method === "POST" && !q.path.endsWith("/leadgen_forms")).length,
    rec,
  };
}

/** What the scenario expected against what happened; empty = it passed. */
export function compareLeads(s: LeadScenario, run: LeadRun): GoldenFailure[] {
  const out: GoldenFailure[] = [];
  const sorted = (l: readonly string[]) => [...l].sort();
  const check = (field: string, expected: unknown, actual: unknown) => {
    if (JSON.stringify(expected) !== JSON.stringify(actual)) out.push({ field, expected, actual });
  };
  const leads = sorted(Object.keys(s.expect.stored));
  // The bar: every lead once, and nothing the scenario did not expect. A second row, or a third road, is red here.
  check("stored", Object.fromEntries(leads.map((l) => [l, [s.expect.stored[l]]])), Object.fromEntries(sorted(Object.keys(run.stored)).map((l) => [l, run.stored[l]])));
  check("accepted", s.expect.accepted, run.accepted);
  check("refused", s.expect.refused, run.refused);
  check("failures", sorted(s.expect.failures), sorted(run.failures));
  check("rung", sorted(s.expect.rung ?? leads), sorted(run.rung));
  check("waiting", sorted(s.expect.waiting), sorted(run.waiting));
  // Rung once per connection per day: a scenario that says so sees exactly one bell, one that does not sees none.
  check("connection_bells", s.expect.connection_bells, run.connectionBells.length);
  const marked = run.rec.writes().filter((q) => q.table === "ads_platform_connections").length > 0;
  check("connection_marked_failing", s.expect.connection_bells > 0, marked);
  for (const [l, want] of Object.entries(s.expect.answers)) for (const [k, v] of Object.entries(want)) check(`answers.${l}.${k}`, v, run.handed[l]?.answers[k]);
  for (const [l, want] of Object.entries(s.expect.verdicts)) for (const [k, v] of Object.entries(want)) check(`verdicts.${l}.${k}`, v, run.verdicts[l]?.[k]);
  for (const [l, want] of Object.entries(s.expect.contact)) check(`contact.${l}`, want.phone_e164, run.handed[l]?.phone_e164 ?? null);
  // True of every lead whatever the scenario: its verdicts written, once each, even after a retry; nothing else touched.
  for (const l of leads) check(`verdictRows.${l}`, Object.keys(run.verdicts[l] ?? { none: 1 }).length, run.verdictRows[l]);
  for (const l of leads) if (!run.verdicts[l]) out.push({ field: `verdicts.${l}`, expected: "written", actual: "none" });
  check("strayWrites", [], run.strayWrites);
  check("metaWrites", 0, run.metaWrites);
  return out;
}
