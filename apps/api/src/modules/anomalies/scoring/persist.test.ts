import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  failScoringAttempt,
  persistScoringOutcome,
  sanitizeOutcomePatch,
  scoringResultHash,
  buildTxnOutcomePatch,
  startScoringAttempt,
} from "./persist.js";

interface FakeOptions {
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  insertError?: { message: string } | null;
  updateData?: unknown;
  updateError?: { message: string } | null;
}

function fakeAdmin(options: FakeOptions = {}) {
  const calls: { kind: string; payload?: Record<string, unknown> }[] = [];
  const admin = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          calls.push({ kind: `${table}.insert`, payload });
          return {
            select() {
              return {
                single: async () => ({
                  data: options.insertError ? null : { id: payload.id },
                  error: options.insertError ?? null,
                }),
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          calls.push({ kind: `${table}.update`, payload });
          const chain = {
            eq: () => chain,
            select: () => ({
              maybeSingle: async () => ({
                data: options.updateError ? null : (options.updateData ?? { id: "attempt-1" }),
                error: options.updateError ?? null,
              }),
            }),
          };
          return chain;
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ kind: `rpc:${fn}`, payload: args });
      return {
        data: options.rpcData ?? { idempotent: false, anomaly_id: null },
        error: options.rpcError ?? null,
      };
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

describe("scoring persistence contract", () => {
  it("hashes equivalent objects independently of key order", () => {
    expect(scoringResultHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      scoringResultHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("creates a running attempt and returns its identity", async () => {
    const { admin, calls } = fakeAdmin();
    const attempt = await startScoringAttempt(admin, {
      orgId: "org-1",
      txnId: "txn-1",
      engineVersion: "commit-1",
      resultHash: "sha256:result",
      verdictHash: "sha256:verdict",
    });

    expect(attempt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]).toMatchObject({
      kind: "scoring_attempts.insert",
      payload: {
        org_id: "org-1",
        transaction_id: "txn-1",
        engine_version: "commit-1",
        result_hash: "sha256:result",
        // 0356 — the judgement-only digest is recorded alongside the payload digest, not instead of
        // it. Two questions, two columns.
        verdict_hash: "sha256:verdict",
        status: "running",
      },
    });
  });

  it("sends the complete outcome to the atomic RPC and exposes idempotent retries", async () => {
    const { admin, calls } = fakeAdmin({ rpcData: { idempotent: true, anomaly_id: "case-1" } });
    const result = await persistScoringOutcome(admin, {
      attempt: { id: "attempt-1", engineVersion: "commit-1", resultHash: "sha256:result" },
      orgId: "org-1",
      txnId: "txn-1",
      vehicleId: "vehicle-1",
      fueledAt: "2026-08-08T12:00:00Z",
      caseFired: [],
      outcome: { case_level: "clear", has_anomaly: false },
    });

    expect(result).toEqual({ idempotent: true, anomalyId: "case-1" });
    expect(calls[0]).toMatchObject({
      kind: "rpc:persist_scoring_outcome_v2",
      payload: {
        p_attempt_id: "attempt-1",
        p_org_id: "org-1",
        p_transaction_id: "txn-1",
        p_vehicle_id: "vehicle-1",
        p_engine_version: "commit-1",
        p_result_hash: "sha256:result",
        p_case: null,
        p_outcome: { case_level: "clear", has_anomaly: false },
        p_recon_status: null,
        p_recon_evidence_version: 1,
      },
    });
  });

  it("surfaces atomic persistence failures", async () => {
    const { admin } = fakeAdmin({ rpcError: { message: "database unavailable" } });
    await expect(
      persistScoringOutcome(admin, {
        attempt: { id: "attempt-1", engineVersion: "commit-1", resultHash: "sha256:result" },
        orgId: "org-1",
        txnId: "txn-1",
        vehicleId: null,
        fueledAt: "2026-08-08T12:00:00Z",
        caseFired: [],
        outcome: {},
      }),
    ).rejects.toThrow("atomic persistence failed");
  });

  it("records a failed running attempt and surfaces failure to record it", async () => {
    const { admin, calls } = fakeAdmin();
    await failScoringAttempt(admin, "attempt-1", "database unavailable");
    expect(calls[0]).toMatchObject({
      kind: "scoring_attempts.update",
      payload: { status: "failed", error: "database unavailable" },
    });

    const failing = fakeAdmin({ updateError: { message: "ledger unavailable" } });
    await expect(
      failScoringAttempt(failing.admin, "attempt-1", "database unavailable"),
    ).rejects.toThrow("could not record failed attempt");
  });
});

describe("sanitizeOutcomePatch — numeric column bounds (incident 2026-08-11)", () => {
  it("nulls values the DB column cannot store and names them in case_gates.out_of_range", () => {
    const patch = sanitizeOutcomePatch({
      computed_mpg: 14000.25, // numeric(6,2) caps at 9999.99 — the overflow that killed the nightly
      miles_since_last: 123.4,
      samsara_fuel_pct_before: 55.2,
      case_gates: { fuel_balance: null },
    });
    expect(patch.computed_mpg).toBeNull();
    expect(patch.miles_since_last).toBe(123.4);
    expect(patch.samsara_fuel_pct_before).toBe(55.2);
    expect(patch.case_gates).toMatchObject({ fuel_balance: null, out_of_range: ["computed_mpg"] });
  });

  it("checks the way Postgres does: rounded to the column scale first", () => {
    // 9999.994 rounds to 9999.99 (fits); 9999.995 rounds to 10000.00 (overflows numeric(6,2)).
    expect(sanitizeOutcomePatch({ computed_mpg: 9999.994 }).computed_mpg).toBe(9999.994);
    expect(sanitizeOutcomePatch({ computed_mpg: 9999.996 }).computed_mpg).toBeNull();
  });

  it("drops non-finite and non-number values, keeps nulls untouched, adds no gate when clean", () => {
    const dirty = sanitizeOutcomePatch({ samsara_odometer: Number.NaN, station_lat: "41.9" });
    expect(dirty.samsara_odometer).toBeNull();
    expect(dirty.station_lat).toBeNull();
    expect((dirty.case_gates as Record<string, unknown>).out_of_range).toEqual([
      "samsara_odometer",
      "station_lat",
    ]);

    const clean = sanitizeOutcomePatch({ computed_mpg: 6.7, miles_since_last: null });
    expect(clean.case_gates).toBeUndefined();
    expect(clean.miles_since_last).toBeNull();
  });

  it("covers every column with negative values too (numeric bounds are symmetric)", () => {
    const patch = sanitizeOutcomePatch({
      station_lng: -1000.1, // numeric(9,6) integer part maxes below 1000
      samsara_observed_lng: -87.6,
    });
    expect(patch.station_lng).toBeNull();
    expect(patch.samsara_observed_lng).toBe(-87.6);
  });
});

/**
 * Q6d (migration 0356) — the split that makes "did the verdict change?" answerable.
 *
 * `result_hash` hashes the whole persistence payload, and the payload carries
 * `samsara_recon_checked_at` — set to `new Date()` on every pass that is not `skipRecon`. Two
 * attempts on one fill under one engine version therefore cannot share it unless both skipped
 * reconciliation. Q6 was analysed three times off that number and was wrong each time; the third
 * analysis used it to reject bounding the scoring cascade, a fix worth ~99% of the work.
 *
 * These pin the property the column was added for: a refresh that changes only the telematics
 * record leaves `verdict_hash` alone, while a change in the judgement moves it. Both directions are
 * asserted, because a hash that never moves would pass a one-sided test perfectly.
 */
describe("verdict hash vs payload hash (Q6d)", () => {
  const args = (over: Record<string, unknown> = {}): Parameters<typeof buildTxnOutcomePatch>[0] =>
    ({
      txn: { id: "t1", vehicleId: "v1", gallons: 100, odometer: 1000, eventAt: "2026-01-14T12:00:00Z" },
      previousTxn: null,
      intermediateGallons: 0,
      assessment: { level: "clear", severity: null, score: 0, signals: [], unscoredSignals: [] },
      // `computeFillConfidence` resolves the truck's capacity and reads the fill size, so the rule
      // context needs a real vehicle and txn — a thinner stub throws inside the gate summary.
      ruleCtx: {
        fuelBalance: null,
        vehicle: { id: "v1", fuelType: "diesel", tankCapacityGal: 240, baselineMpg: 6.2 },
        txn: { id: "t1", vehicleId: "v1", gallons: 100 },
      },
      attribution: { verdict: "ok", logbookVehicleId: null },
      recon: {
        crossSourceOdometer: null, crossSourceOdometerAt: null, crossSourceOdometerSource: null,
        samsaraLocationMatched: null, locationConfidence: null, stationLat: null, stationLng: null,
        nearestStationMiles: null, locationEvidence: null, reconAt: null, tankFillShortGal: null,
        tankObservedRiseGal: null, tankPctBefore: null, tankPctAfter: null, observedState: null,
        observedCity: null, observedAddress: null, observedLat: null, observedLng: null,
        fuelingTimeBasis: null, reconCheckedAt: "2026-09-22T10:00:00Z", reconStatus: "success",
        reconError: null, reconEvidenceVersion: 141,
      },
      ...over,
    }) as unknown as Parameters<typeof buildTxnOutcomePatch>[0];

  const hashes = (a: Parameters<typeof buildTxnOutcomePatch>[0]) => {
    const { patch, verdict } = buildTxnOutcomePatch(a);
    return {
      result: scoringResultHash({ txnId: "t1", engineVersion: "e1", caseFired: [], outcome: patch }),
      verdict: scoringResultHash({ txnId: "t1", engineVersion: "e1", caseFired: [], verdict }),
    };
  };

  it("a re-reconciliation that changes only the telematics record moves result_hash and NOT verdict_hash", () => {
    const before = hashes(args());
    // Exactly what a live refresh does to a settled fill: a new checked_at, a bumped evidence
    // version, and an identical judgement.
    const after = hashes(
      args({
        recon: {
          ...(args().recon as unknown as Record<string, unknown>),
          reconCheckedAt: "2026-09-22T18:00:00Z",
          reconEvidenceVersion: 142,
        },
      }),
    );

    expect(after.result).not.toBe(before.result); // the payload really did change
    expect(after.verdict).toBe(before.verdict); // …and the judgement did not
  });

  it("a changed judgement moves verdict_hash", () => {
    const before = hashes(args());
    const after = hashes(
      args({
        assessment: { level: "theft_case", severity: "high", score: 80, signals: ["tank_fill_short"], unscoredSignals: [] },
      }),
    );

    expect(after.verdict).not.toBe(before.verdict);
  });

  it("scoring_version is NOT in the verdict — a derivation bump must not read as every fill changing", () => {
    // It identifies the producer, and `engineVersion` is already in the tuple both digests cover.
    const { patch, verdict } = buildTxnOutcomePatch(args());
    expect(patch.scoring_version).toBeDefined();
    expect(verdict).not.toHaveProperty("scoring_version");
  });

  it("the verdict carries no Samsara evidence, the station pin or the recon status", () => {
    const { verdict } = buildTxnOutcomePatch(args());
    for (const key of Object.keys(verdict)) {
      expect(key.startsWith("samsara_")).toBe(false);
      expect(key.startsWith("station_")).toBe(false);
      expect(key).not.toBe("fueling_time_basis");
    }
    // …and it does carry the judgement, so the assertion above is not passing on an empty object.
    expect(Object.keys(verdict)).toEqual(
      expect.arrayContaining(["case_level", "case_score", "case_signals", "case_gates", "computed_mpg", "attribution_verdict"]),
    );
  });

  it("hashes the SANITISED verdict, so an out-of-range value is hashed as the null that was stored", () => {
    // A garbage odometer yields a computed_mpg of ~14,000; `computed_mpg numeric(6,2)` caps at
    // 9,999.99, so the bound nulls it and names it in case_gates.out_of_range (incident 2026-08-11).
    // Hashing the pre-sanitised value would disagree with what the row actually holds.
    const wild = args({
      txn: { id: "t1", vehicleId: "v1", gallons: 0.001, odometer: 100000, eventAt: "2026-01-14T12:00:00Z" },
      previousTxn: { id: "t0", vehicleId: "v1", gallons: 100, odometer: 1000, eventAt: "2026-01-01T12:00:00Z" },
    });
    const { patch, verdict } = buildTxnOutcomePatch(wild);
    expect(patch.computed_mpg).toBeNull();
    expect(verdict.computed_mpg).toBeNull();
    expect((patch.case_gates as Record<string, unknown>).out_of_range).toContain("computed_mpg");
    // The annotation survives into the verdict half — it is a verdict about the verdict.
    expect((verdict.case_gates as Record<string, unknown>).out_of_range).toContain("computed_mpg");
  });
});
