import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LeadOutcome } from "@silvicom/shared";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { MetaGraph, resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { runOutcomeFeed, type OutcomeFeedDeps } from "./outcomeFeed.js";
import { MAX_ATTEMPTS } from "./outcomeLedger.js";
import { CAMP, CONN, DATASET, hoursAgo, lead, NOW, ORG, outcome, TOKEN, world } from "./outcomeWorld.js";

/**
 * The outcome feed (B6) against FakeMeta's Conversions API dataset and `outcomeWorld.ts`'s ledger (0537's unique
 * ref and its queued-or-failed guard).
 */

let meta: FakeMeta;
let base: string;
let clock = new Date(NOW);

beforeEach(async () => {
  clock = new Date(NOW);
  meta = new FakeMeta({ token: TOKEN, accounts: [], now: () => clock });
  meta.datasets.create(DATASET);
  base = await meta.start();
});
afterEach(async () => {
  resetGraphThrottles();
  await meta.stop();
});

function deps(w: ReturnType<typeof world>, extra: Partial<OutcomeFeedDeps> = {}): OutcomeFeedDeps {
  return {
    admin: w.rec.client, env: testEnv(), now: () => clock, outcomes: w.outcomes, targets: w.targets,
    openGraph: async () => ({ ok: true, simulated: false, graph: new MetaGraph({ token: TOKEN, throttleKey: `connection:${CONN}`, baseUrl: base, now: () => clock, sleep: async () => {}, timeoutMs: 300 }) }),
    ...extra,
  };
}

const accepted = () => meta.datasets.accepted(DATASET);
const statuses = (w: ReturnType<typeof world>) => Object.fromEntries(w.events.map((e) => [e.source_event_ref, e.status]));

describe("the outcome feed — each recorded stage to Meta once (B6, L1)", () => {
  it("sends one CRM event per recorded stage of each Meta lead, under the lead's Meta id, and ledgers each as sent", async () => {
    const w = world({ outcomes: [
      outcome(1, { contacted: hoursAgo(70), converted: hoursAgo(48) }),
      outcome(2, { contacted: hoursAgo(60) }),
    ] });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r).toMatchObject({ ran: true, queued: 3, sent: 3, refused: 0, failures: [] });
    expect(accepted().map((e) => [e.event_id, e.event_name, e.user_data.lead_id])).toEqual([
      [`${lead(1)}:contacted`, "contacted", "120000000000001"],
      [`${lead(1)}:converted`, "converted", "120000000000001"],
      [`${lead(2)}:contacted`, "contacted", "120000000000002"],
    ]);
    expect(accepted()[1]!.event_time).toBe(Math.floor(Date.parse(hoursAgo(48)) / 1000));
    expect(w.events.every((e) => e.status === "sent" && e.attempts === 1 && e.sent_at === NOW && e.campaign_id === CAMP)).toBe(true);
    expectOrgScoped(w.rec, ORG);
  });

  it("the event carries the lead id and the stage and nothing about the person (D-AD14)", async () => {
    const w = world({ outcomes: [outcome(1, { converted: hoursAgo(5) })] });
    await runOutcomeFeed(deps(w), ORG, CONN);
    const { test_event_code: _, ...sent } = accepted()[0]!;
    expect(sent).toEqual({
      event_name: "converted", event_time: Math.floor(Date.parse(hoursAgo(5)) / 1000), event_id: `${lead(1)}:converted`,
      action_source: "system_generated", user_data: { lead_id: "120000000000001" },
      custom_data: { event_source: "crm", lead_event_source: "Silvicom 360" },
    });
  });

  it("a lead from another platform is never sent, and a stage outside the recorded list is refused as malformed", async () => {
    const w = world({ outcomes: [
      outcome(1, { contacted: hoursAgo(5) }, { provider: "tiktok" }),
      // `qualified` became a recorded stage with 0578/0580 (LQ5); `disqualified` is nobody's word.
      outcome(2, { disqualified: hoursAgo(5) } as unknown as LeadOutcome["reached"]),
    ] });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(accepted()).toEqual([]);
    expect(w.events).toEqual([]);
    expect(r.failures).toEqual([{ reason: "outcomes:malformed" }]);
  });

  it("a carrier whose feed is off (no target) is not read, sends nothing and writes nothing", async () => {
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(5) })], target: false });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r).toMatchObject({ ran: false, queued: 0, sent: 0, failures: [] });
    expect(meta.datasets.requests).toBe(0);
    expect(w.rec.queries.filter((q) => q.table === "ads_outcome_events")).toHaveLength(0);
  });
});

describe("the outcome feed's faults (§4R Outcome feed, L2): exactly one accepted event per stage row", () => {
  it("replayed the next day, every stage is already on the ledger: nothing is sent twice", async () => {
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(70), converted: hoursAgo(48) })] });
    await runOutcomeFeed(deps(w), ORG, CONN);
    clock = new Date(Date.parse(NOW) + 86_400_000);
    const again = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(again).toMatchObject({ queued: 0, sent: 0, failures: [] });
    expect(accepted()).toHaveLength(2);
    expect(w.events).toHaveLength(2);
    expect(meta.datasets.requests).toBe(1);
  });

  it("killed after Meta accepted but before the ledger said so, the resend is dropped by its event_id: one accepted event", async () => {
    const w = world({ outcomes: [outcome(1, { converted: hoursAgo(5) })] });
    w.crashUpdates(1);
    await expect(runOutcomeFeed(deps(w), ORG, CONN)).rejects.toThrow(/injected crash/);
    expect(statuses(w)).toEqual({ [`${lead(1)}:converted`]: "queued" });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r.sent).toBe(1);
    expect(accepted()).toHaveLength(1);
    expect(statuses(w)).toEqual({ [`${lead(1)}:converted`]: "sent" });
  });

  it("two runs racing to queue the same stage store it once (the unique ref), and it is sent once", async () => {
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(5) })] });
    await Promise.all([runOutcomeFeed(deps(w), ORG, CONN), runOutcomeFeed(deps(w), ORG, CONN)]);
    expect(w.events).toHaveLength(1);
    expect(accepted()).toHaveLength(1);
  });

  it("a stage reached more than 28 days after the lead arrived is still sent, once (28 days is Meta's optimisation window, not a send limit)", async () => {
    const w = world({ outcomes: [outcome(1, { hired: hoursAgo(3) }, { arrived_at: hoursAgo(24 * 40) })] });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r.sent).toBe(1);
    expect(accepted().map((e) => e.event_name)).toEqual(["hired"]);
  });

  it("a stage that failed until it turned 7 days old is then recorded skipped, never sent", async () => {
    meta.inject("POST", /\/events$/, { kind: "temporary" }, 3);
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(24 * 6) }, { arrived_at: hoursAgo(24 * 7) })] });
    await runOutcomeFeed(deps(w), ORG, CONN);
    expect(w.events[0]).toMatchObject({ status: "failed", attempts: 1 });
    clock = new Date(Date.parse(NOW) + 2 * 86_400_000);
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r).toMatchObject({ skipped: 1, sent: 0, failures: [] });
    expect(w.events[0]).toMatchObject({ status: "skipped", response: { reason: "older_than_7_days" } });
    expect(accepted()).toEqual([]);
  });

  it("a stage that is no longer recorded when its turn comes is recorded skipped, never sent", async () => {
    meta.inject("POST", /\/events$/, { kind: "temporary" }, 3);
    const list = [outcome(1, { contacted: hoursAgo(5) })];
    const w = world({ outcomes: list });
    await runOutcomeFeed(deps(w), ORG, CONN);
    list[0] = outcome(1, {});
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r).toMatchObject({ skipped: 1, sent: 0 });
    expect(w.events[0]).toMatchObject({ status: "skipped", response: { reason: "stage_no_longer_recorded" } });
    expect(accepted()).toEqual([]);
  });

  it("a stage reached more than 7 days ago is recorded skipped and never sent: Meta would refuse the whole request", async () => {
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(24 * 7 + 1), converted: hoursAgo(5) }, { arrived_at: hoursAgo(24 * 9) })] });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r).toMatchObject({ queued: 1, skipped: 1, sent: 1, failures: [] });
    expect(statuses(w)).toEqual({ [`${lead(1)}:contacted`]: "skipped", [`${lead(1)}:converted`]: "sent" });
    expect(w.events.find((e) => e.status === "skipped")!.response).toMatchObject({ reason: "older_than_7_days" });
    expect(accepted().map((e) => e.event_name)).toEqual(["converted"]);
  });

  it("an event Meta refuses is recorded failed and final, rung once, and the rest of its batch is still sent", async () => {
    meta.datasets.refuse("120000000000002");
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(5) }), outcome(2, { contacted: hoursAgo(5) }), outcome(3, { contacted: hoursAgo(5) })] });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r).toMatchObject({ sent: 2, refused: 1, failures: [] });
    const refused = w.events.find((e) => e.source_event_ref === `${lead(2)}:contacted`)!;
    expect(refused).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, response: { error_code: "meta_100" } });
    expect(w.bell.filter((b) => b.category === "ads_rejected")).toHaveLength(1);

    clock = new Date(Date.parse(NOW) + 86_400_000);
    const before = meta.datasets.requests;
    const again = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(again).toMatchObject({ sent: 0, refused: 0 });
    expect(meta.datasets.requests).toBe(before);
    expect(w.bell.filter((b) => b.category === "ads_rejected")).toHaveLength(1);
    expect(accepted().map((e) => e.user_data.lead_id)).toEqual(["120000000000001", "120000000000003"]);
  });

  it.each([
    ["a throttle (80004)", { kind: "throttle", regainMinutes: 1 }, 1],
    ["three server errors in a row (beyond the client's two retries)", { kind: "temporary" }, 3],
    ["a request Meta never answers", { kind: "hang" }, 3],
  ] as const)("%s fails the run and leaves the stage due; the next run sends it once", async (_label, fault, times) => {
    meta.inject("POST", /\/events$/, fault, times);
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(5) })] });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r.sent).toBe(0);
    expect(r.failures.map((f) => f.reason)).toEqual([expect.stringMatching(/^send:(rate_limited|transient|timeout)$/)]);
    expect(w.events[0]).toMatchObject({ status: "failed", attempts: 1 });
    resetGraphThrottles();
    clock = new Date(Date.parse(NOW) + 86_400_000);
    const next = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(next).toMatchObject({ sent: 1, failures: [] });
    expect(accepted()).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("a stage that keeps failing is tried MAX_ATTEMPTS times and never again", async () => {
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(1) })] });
    for (let day = 0; day < MAX_ATTEMPTS + 2; day += 1) {
      meta.inject("POST", /\/events$/, { kind: "temporary" }, 3);
      clock = new Date(Date.parse(NOW) + day * 3_600_000);
      await runOutcomeFeed(deps(w), ORG, CONN);
    }
    expect(w.events[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    // Each run is one send and the client's two retries; after MAX_ATTEMPTS runs nothing more is sent.
    expect(meta.requests.filter((q) => q.path.endsWith("/events"))).toHaveLength(MAX_ATTEMPTS * 3);
  });

  it("a revoked token fails the run, keeps the stage due, marks the connection failing and rings ads_token_expiring once", async () => {
    meta.revokeToken();
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(5) })] });
    const r = await runOutcomeFeed(deps(w), ORG, CONN);
    expect(r.failures).toEqual([{ reason: "send:token_invalid" }]);
    expect(w.events[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(w.connections[0]!.status).toBe("failing");
    await runOutcomeFeed(deps(w), ORG, CONN);
    expect(w.bell.filter((b) => b.category === "ads_token_expiring")).toHaveLength(1);
    expect(accepted()).toEqual([]);
  });

  it("a dataset Meta does not have fails the run as a setup fault and writes no event's result", async () => {
    const w = world({ outcomes: [outcome(1, { contacted: hoursAgo(5) })] });
    const r = await runOutcomeFeed({ ...deps(w), targets: { targetFor: async () => ({ dataset_id: "779999999999999" }) } }, ORG, CONN);
    expect(r.failures).toEqual([{ reason: "dataset:not_found" }]);
    expect(w.events[0]).toMatchObject({ status: "queued", attempts: 0 });
    expect(w.bell).toEqual([]);
  });
});
