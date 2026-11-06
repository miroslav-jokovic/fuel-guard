import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testEnv } from "../../../testing/testEnv.js";
import { MetaGraph, resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { FakeMeta, type FakeMetaFault } from "../platforms/simulator/fakeMeta.js";
import { runOutcomeFeed, type OutcomeFeedDeps } from "./outcomeFeed.js";
import { MAX_ATTEMPTS } from "./outcomeLedger.js";
import { CONN, DATASET, hoursAgo, lead, NOW, ORG, outcome, TOKEN, world } from "./outcomeWorld.js";

/**
 * Outcome feed L3 (§4R: "exactly one accepted event per stage row"), as the Renderer's sweep is its L3: the run is
 * killed at EVERY point where a kill can leave the world half-done, under each fault FakeMeta plays, and then the
 * following days run clean. Whatever happened, the end state must be the same:
 *   · one ledger row per stage, never two (the unique ref);
 *   · Meta holds exactly one accepted event per stage, none for a lead it refuses (its dedup by event_id is what
 *     absorbs a resend after a lost answer: `fakeMetaEvents.ts`);
 *   · every row final: `sent`, or `failed` at MAX_ATTEMPTS for the refused lead, rung once.
 *
 * The kill points, counted from a clean run so none is skipped:
 *   insert N   the process dies at the Nth ledger INSERT (queueing a stage)
 *   update N   the Nth ledger UPDATE (a send's result), so AFTER Meta took the batch
 *   answer N   the Nth Conversions API call reaches Meta and is applied, and its answer is lost
 */

const LEADS = () => [
  outcome(1, { contacted: hoursAgo(70), converted: hoursAgo(48) }),
  outcome(2, { contacted: hoursAgo(60) }),
  outcome(3, { contacted: hoursAgo(30), applied: hoursAgo(6) }),
];
const STAGES = [`${lead(1)}:contacted`, `${lead(1)}:converted`, `${lead(2)}:contacted`, `${lead(3)}:contacted`, `${lead(3)}:applied`];
const REFUSED_LEAD = "120000000000002";

type Fault = { name: string; meta?: FakeMetaFault; times?: number; refuse?: boolean };
const FAULTS: Fault[] = [
  { name: "no fault" },
  { name: "a throttle", meta: { kind: "throttle", regainMinutes: 1 }, times: 1 },
  { name: "three 5xx", meta: { kind: "temporary" }, times: 3 },
  { name: "a request never answered", meta: { kind: "hang" }, times: 3 },
  { name: "one lead refused", refuse: true },
];

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

/** A fetch that loses the answer of the `n`th events call after Meta applied it (0 = never). */
function losingAnswer(n: number): typeof fetch {
  let calls = 0;
  return async (input, init) => {
    const res = await fetch(input, init);
    if (String(input).endsWith("/events") && ++calls === n) throw new TypeError("socket hang up (answer lost after Meta applied it)");
    return res;
  };
}

function depsFor(w: ReturnType<typeof world>, lose: number): OutcomeFeedDeps {
  const f = losingAnswer(lose);
  return {
    admin: w.rec.client, env: testEnv(), now: () => clock, outcomes: w.outcomes, targets: w.targets, batchSize: 2,
    openGraph: async () => ({ ok: true, simulated: false, graph: new MetaGraph({ token: TOKEN, throttleKey: `connection:${CONN}`, baseUrl: base, now: () => clock, sleep: async () => {}, timeoutMs: 60, fetch: f }) }),
  };
}

/**
 * Day one with the fault, then five more days. The kill lands wherever its write or call falls: under a fault the
 * Nth update may be a later day's, so every day's run may be the killed one (a failed run is the queue's to retry).
 */
async function runDays(w: ReturnType<typeof world>, lose: number): Promise<void> {
  await runOutcomeFeed(depsFor(w, lose), ORG, CONN).catch(() => undefined);
  for (let day = 1; day <= 5; day += 1) {
    resetGraphThrottles();
    clock = new Date(Date.parse(NOW) + day * 3_600_000);
    await runOutcomeFeed(depsFor(w, 0), ORG, CONN).catch(() => undefined);
  }
}

function expectOneEach(w: ReturnType<typeof world>, refused: boolean): void {
  expect(w.events.map((e) => e.source_event_ref).sort()).toEqual([...STAGES].sort());
  for (const ref of STAGES) {
    const isRefused = refused && ref === `${lead(2)}:contacted`;
    expect(meta.datasets.accepted(DATASET).filter((e) => e.event_id === ref), ref).toHaveLength(isRefused ? 0 : 1);
    expect(w.events.find((e) => e.source_event_ref === ref), ref).toMatchObject(isRefused ? { status: "failed", attempts: MAX_ATTEMPTS } : { status: "sent" });
  }
  expect(w.bell.filter((b) => b.category === "ads_rejected")).toHaveLength(refused ? 1 : 0);
}

/** How many inserts, updates and events calls a clean run makes, so the sweep kills at each one. */
async function cleanCounts(): Promise<{ inserts: number; updates: number; calls: number }> {
  const w = world({ outcomes: LEADS() });
  await runOutcomeFeed(depsFor(w, 0), ORG, CONN);
  const writes = (m: string) => w.rec.queries.filter((q) => q.table === "ads_outcome_events" && q.write?.method === m).length;
  const counts = { inserts: writes("insert"), updates: writes("update"), calls: meta.datasets.requests };
  await meta.stop();
  meta = new FakeMeta({ token: TOKEN, accounts: [], now: () => clock });
  meta.datasets.create(DATASET);
  base = await meta.start();
  return counts;
}

describe("Outcome feed L3 — killed after every write and Meta call, under each fault: exactly one accepted event per stage row", () => {
  it("a clean run makes the writes and calls the sweep kills at (5 inserts, 5 updates, 3 batches)", async () => {
    expect(await cleanCounts()).toEqual({ inserts: 5, updates: 5, calls: 3 });
  });

  const POINTS = [
    ...[1, 2, 3, 4, 5].map((n) => ({ name: `insert ${n}`, kind: "insert" as const, n })),
    ...[1, 2, 3, 4, 5].map((n) => ({ name: `update ${n}`, kind: "update" as const, n })),
    ...[1, 2, 3].map((n) => ({ name: `answer ${n}`, kind: "answer" as const, n })),
  ];
  const CASES = FAULTS.flatMap((f) => POINTS.map((p) => [`${p.name} × ${f.name}`, p, f] as const));

  it.each(CASES)("killed at %s ends with one accepted event per stage row", async (_name, point, fault) => {
    if (fault.meta) meta.inject("POST", /\/events$/, fault.meta, fault.times);
    if (fault.refuse) meta.datasets.refuse(REFUSED_LEAD);
    const w = world({ outcomes: LEADS() });
    if (point.kind !== "answer") w.crashAtWrite(point.kind, point.n);
    await runDays(w, point.kind === "answer" ? point.n : 0);
    expectOneEach(w, fault.refuse === true);
  });
});
