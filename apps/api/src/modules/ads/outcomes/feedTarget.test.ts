import { afterEach, describe, expect, it } from "vitest";
import { ADS_SETTINGS_UNSET, adsSettingsSchema, type AdsSettings } from "@silvicom/shared";
import { testEnv } from "../../../testing/testEnv.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_DATASET_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import { saveSettingsVersion } from "../settings/settingsVersions.js";
import { settingsFeedTargets } from "./feedTarget.js";
import { runOutcomeFeed } from "./outcomeFeed.js";
import { CONN, lead, ORG, outcome, world } from "./outcomeWorld.js";

/**
 * Q-AD40, ruled 2026-11-06: the outcome feed's switch and dataset are the settings version in force
 * (`outcome_feed`, optional, absent = off), and a simulator connection runs the feed only where `simulatorGate`
 * allows. The simulator runs here end to end: the REAL registry opens the in-process FakeMeta, whose dataset is
 * `SIMULATOR_DATASET_ID`.
 */

const STAGING = { RAILWAY_ENVIRONMENT_NAME: "uat", NODE_ENV: "production" };
const PRODUCTION = { RAILWAY_ENVIRONMENT_NAME: "production", NODE_ENV: "production" };
const on = (dataset_id: string): AdsSettings => ({ ...ADS_SETTINGS_UNSET, outcome_feed: { enabled: true, dataset_id } });
const ACTOR = { id: "00000000-0000-4000-8000-0000000000d1", name: "Owner" };

afterEach(async () => {
  resetGraphThrottles();
  await stopSimulatorForTests();
});

describe("the outcome feed's target — the settings version in force (Q-AD40 (1))", () => {
  it("is off by default: a carrier who never saved settings has no target", async () => {
    const w = world({ outcomes: [], settings: [] });
    expect(await settingsFeedTargets(w.rec.client, PRODUCTION).targetFor(ORG, CONN)).toBeNull();
  });

  it("a version saved WITHOUT the group (an older form) parses, and reads as off", async () => {
    const older = { ...ADS_SETTINGS_UNSET } as Record<string, unknown>;
    delete older.outcome_feed;
    expect(adsSettingsSchema.safeParse(older).success).toBe(true);
    const w = world({ outcomes: [], settings: [older as AdsSettings] });
    expect(await settingsFeedTargets(w.rec.client, PRODUCTION).targetFor(ORG, CONN)).toBeNull();
  });

  it("on with a dataset id, a Meta connection's target is that dataset", async () => {
    const w = world({ outcomes: [], settings: [on("770000000000001")] });
    expect(await settingsFeedTargets(w.rec.client, PRODUCTION).targetFor(ORG, CONN)).toEqual({ dataset_id: "770000000000001" });
  });

  it("switched off with a dataset id still named, there is no target", async () => {
    const w = world({ outcomes: [], settings: [{ ...ADS_SETTINGS_UNSET, outcome_feed: { enabled: false, dataset_id: "770000000000001" } }] });
    expect(await settingsFeedTargets(w.rec.client, PRODUCTION).targetFor(ORG, CONN)).toBeNull();
  });

  it("the switch cannot be saved on without a dataset, nor with a dataset id that is not digits", () => {
    expect(adsSettingsSchema.safeParse({ ...ADS_SETTINGS_UNSET, outcome_feed: { enabled: true, dataset_id: null } }).success).toBe(false);
    expect(adsSettingsSchema.safeParse({ ...ADS_SETTINGS_UNSET, outcome_feed: { enabled: true, dataset_id: "act_77" } }).success).toBe(false);
    expect(adsSettingsSchema.safeParse({ ...ADS_SETTINGS_UNSET, outcome_feed: { enabled: false, dataset_id: null } }).success).toBe(true);
  });

  it("the replace-whole-object trap: a save carrying the group keeps the feed on; a save without it turns it off", async () => {
    const w = world({ outcomes: [], settings: [on("770000000000001")] });
    const targets = settingsFeedTargets(w.rec.client, PRODUCTION);
    // A later save of another field, carrying the group through: still on.
    await saveSettingsVersion(w.rec.client, ORG, ACTOR, { settings: { ...on("770000000000001"), approvals: { second_approver_above_cents: 50_000 } } });
    expect(await targets.targetFor(ORG, CONN)).toEqual({ dataset_id: "770000000000001" });
    // A form that does not know the group saves the object without it: the feed is off from that version.
    await saveSettingsVersion(w.rec.client, ORG, ACTOR, { settings: { ...ADS_SETTINGS_UNSET, approvals: { second_approver_above_cents: 50_000 } } });
    expect(await targets.targetFor(ORG, CONN)).toBeNull();
    expect(w.versions).toHaveLength(3);
  });
});

describe("the simulator runs the outcome feed only where the simulator gate allows (Q-AD40 (2))", () => {
  // The in-process simulator keeps the real clock, as it does on staging, and applies Meta's own
  // seven-day rule to every event it is sent. These leads are therefore dated from the real clock
  // too. Dated from outcomeWorld's fixed NOW (2026-11-06) they passed for exactly a week and then
  // failed on every branch from 2026-11-13, when the events turned eight days old.
  const recently = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const simLead = (n: number) => outcome(n, { contacted: recently(5) }, { provider: "simulator", platform_lead_ref: `99000000000${n}`, arrived_at: recently(72) });

  it("on staging, a simulator connection's stages reach the simulator's own dataset, once each", async () => {
    const w = world({ outcomes: [simLead(1), outcome(2, { contacted: recently(5) }, { arrived_at: recently(72) })], provider: "simulator", settings: [on(SIMULATOR_DATASET_ID)] });
    const deps = { admin: w.rec.client, env: testEnv(), now: () => new Date(), outcomes: w.outcomes, targets: settingsFeedTargets(w.rec.client, STAGING), processEnv: STAGING };
    const r = await runOutcomeFeed(deps, ORG, CONN);
    expect(r).toMatchObject({ ran: true, sent: 1, failures: [] });
    const fake = await simulatorFakeForTests();
    expect(fake.datasets.accepted(SIMULATOR_DATASET_ID).map((e) => [e.event_id, e.user_data.lead_id])).toEqual([[`${lead(1)}:contacted`, "990000000001"]]);
    expect(w.events.map((e) => [e.provider, e.status])).toEqual([["simulator", "sent"]]);
    await runOutcomeFeed(deps, ORG, CONN);
    expect(fake.datasets.accepted(SIMULATOR_DATASET_ID)).toHaveLength(1);
  });

  it("a run speaks only for its own platform: a Meta row due on the ledger is never sent to the simulator", async () => {
    const w = world({ outcomes: [simLead(1)], provider: "simulator", settings: [on(SIMULATOR_DATASET_ID)] });
    w.events.push({ id: "oe-meta", org_id: ORG, provider: "meta", platform_lead_ref: "120000000000009", stage: "contacted",
      source_event_ref: `${lead(9)}:contacted`, status: "queued", attempts: 0, response: null, sent_at: null, campaign_id: null, created_at: "2026-11-01T00:00:00Z" });
    await runOutcomeFeed({ admin: w.rec.client, env: testEnv(), now: () => new Date(), outcomes: w.outcomes, targets: settingsFeedTargets(w.rec.client, STAGING), processEnv: STAGING }, ORG, CONN);
    const fake = await simulatorFakeForTests();
    expect(fake.datasets.accepted(SIMULATOR_DATASET_ID).map((e) => e.event_id)).toEqual([`${lead(1)}:contacted`]);
    expect(w.events.find((e) => e.id === "oe-meta")).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("on production, a simulator connection has no target: nothing is ledgered or sent, even with the switch on", async () => {
    const w = world({ outcomes: [simLead(1)], provider: "simulator", settings: [on(SIMULATOR_DATASET_ID)] });
    const targets = settingsFeedTargets(w.rec.client, PRODUCTION);
    expect(await targets.targetFor(ORG, CONN)).toBeNull();
    const r = await runOutcomeFeed({ admin: w.rec.client, env: testEnv(), now: () => new Date(), outcomes: w.outcomes, targets, processEnv: PRODUCTION }, ORG, CONN);
    expect(r).toMatchObject({ ran: false, sent: 0 });
    expect(w.events).toEqual([]);
  });

  it("on production, even a target handed in by mistake cannot open the simulator: the registry refuses and nothing is sent", async () => {
    const w = world({ outcomes: [simLead(1)], provider: "simulator" });
    const r = await runOutcomeFeed({
      admin: w.rec.client, env: testEnv(), now: () => new Date(), outcomes: w.outcomes, processEnv: PRODUCTION,
      targets: { targetFor: async () => ({ dataset_id: SIMULATOR_DATASET_ID }) },
    }, ORG, CONN);
    expect(r.sent).toBe(0);
    expect(r.failures).toEqual([{ reason: "graph:simulator_not_allowed" }]);
    expect(w.events.every((e) => e.status === "queued")).toBe(true);
  });
});
