import { describe, it, expect } from "vitest";
import { backfillOrg } from "./backfill.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * The collector tier's claim (SAM-S3, D-SAM1).
 *
 * ── WHAT THIS IS ACTUALLY PINNING ────────────────────────────────────────────────────────────────
 * Per-fill telematics used to be fetched only as a side effect of scoring, and the bulk path set
 * `skipRecon` to protect the vendor rate limit — so 10,644 of 13,711 tractor fills (77.6%, measured
 * 2026-09-01) had never had it fetched at all, and nothing incidental was going to fix that. The tier
 * this claim serves is what makes collection independent of scoring.
 *
 * The assertions are on the QUERY rather than on rows, because the query IS the design: which fills
 * the tier claims, in what order, and what stops it claiming the same ones forever. Getting rows back
 * would prove the fixture, not the predicate.
 */

const ORG = "11111111-1111-1111-1111-111111111111";

/** The claim is the read of `fuel_transactions` that carries a limit — the tier takes one bounded bite. */
const claimQuery = (queries: RecordedQuery[]): RecordedQuery | undefined =>
  queries.find((q) => q.table === "fuel_transactions" && q.ops.some((o) => o.method === "limit"));

const opArgs = (q: RecordedQuery, method: string): unknown[] =>
  q.ops.filter((o) => o.method === method).flatMap((o) => o.args);

async function runClaim(claim: { limit: number; retryAfterHours: number }) {
  const rec = createSupabaseRecorder({ tables: { fuel_transactions: [], vehicles: [], organizations: [] } });
  await backfillOrg(rec.client, testEnv(), ORG, { reconClaim: claim });
  return rec;
}

describe("the per-fill telematics claim", () => {
  it("takes ONE bounded bite, oldest first — a rate budget, not a target", async () => {
    const rec = await runClaim({ limit: 250, retryAfterHours: 72 });
    const q = claimQuery(rec.queries);
    expect(q, "the claim query was never issued").toBeDefined();
    expect(opArgs(q!, "limit")).toEqual([250]);
    // Oldest-first is deliberate: the hole is historical (2026-03, -04 and -06 have ZERO successful
    // reconciliations while 2026-08 onward is ~100%), so newest-first would spend every tick
    // re-confirming the part that already works.
    const order = q!.ops.filter((o) => o.method === "order");
    expect(order[0]!.args[0]).toBe("fueled_at");
    expect(order[0]!.args[1]).toMatchObject({ ascending: true });
  });

  it("claims only fills that still have no stored telematics", async () => {
    const rec = await runClaim({ limit: 10, retryAfterHours: 72 });
    const q = claimQuery(rec.queries)!;
    expect(q.filters()).toContainEqual({ col: "samsara_recon_at", val: null });
  });

  /**
   * The wedge this cooldown exists to prevent: 32 fills come back `no_data`, keep a null
   * `samsara_recon_at` forever, and — claimed oldest-first — would be re-fetched on every single tick
   * while the other 10,612 were never reached. A scheduler that runs hourly and makes no progress is
   * worse than none, because it looks busy.
   */
  it("skips a fill attempted inside the cooldown, and takes one attempted before it", async () => {
    const before = Date.now();
    const rec = await runClaim({ limit: 10, retryAfterHours: 72 });
    const after = Date.now();
    const q = claimQuery(rec.queries)!;
    const or = opArgs(q, "or").find((a): a is string => typeof a === "string");
    expect(or, "the claim did not carry a cooldown clause").toBeDefined();
    expect(or).toContain("samsara_recon_checked_at.is.null");
    const cutoff = /samsara_recon_checked_at\.lt\.(\S+)$/.exec(or!)?.[1];
    expect(cutoff, "the cooldown clause names no cutoff instant").toBeDefined();
    const ms = Date.parse(cutoff!);
    expect(ms).toBeGreaterThanOrEqual(before - 72 * 3_600_000 - 1000);
    expect(ms).toBeLessThanOrEqual(after - 72 * 3_600_000 + 1000);
  });

  it("is org-scoped, like every other service-role read", async () => {
    const rec = await runClaim({ limit: 10, retryAfterHours: 72 });
    // `organizations` is the ONE table whose tenant key is `id` rather than `org_id` — it IS the org
    // row — and `loadOperatingHours` reads it with `.eq("id", orgId)`, which is the same boundary
    // spelled the only way that table can spell it.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  /**
   * `skipRecon` is the flag that made collection a side effect of scoring in the first place. A claim
   * run is a COLLECTION pass, so the combination is meaningless — and it would fail quietly, as an
   * empty batch that looks like "nothing to do", which is the failure mode this whole step is about.
   */
  it("refuses to be a scoring pass — reconClaim with skipRecon throws rather than fetching nothing", async () => {
    const rec = createSupabaseRecorder({ tables: { fuel_transactions: [], vehicles: [], organizations: [] } });
    await expect(
      backfillOrg(rec.client, testEnv(), ORG, { skipRecon: true, reconClaim: { limit: 10, retryAfterHours: 72 } }),
    ).rejects.toThrow(/collection pass/);
  });
});
