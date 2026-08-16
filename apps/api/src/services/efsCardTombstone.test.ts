import { describe, expect, it } from "vitest";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { testEnv } from "../testing/testEnv.js";
import { cardRefHmac } from "./efsCardRef.js";
import { tombstoneAbsentCards } from "./efsCardTombstone.js";
import type { CardSummaryRow } from "../lib/efsCardOps.js";

/**
 * The ratio guard (Step 7.5).
 *
 * The failure this exists for, in the plan's own numbers: *"today a partial roster of 40/199 stamps
 * `absent_since` on 159 live cards"*. The only guard was a non-empty roster, which catches the
 * vendor returning NOTHING and nothing else — and a SHORT response is not an error, so the far
 * likelier shape went straight through.
 *
 * Marking a live card absent is the destructive direction: it drops out of `linkFuelCards`, out of
 * every count built on `absent_since is null`, and the fleet's fuel attribution shrinks by however
 * many cards a bad roster invented. So the assertions below are mostly about what is NOT written.
 */

const ORG = "org-1";
const env = testEnv({ SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });

const pan = (n: number) => `7083000000000${String(n).padStart(4, "0")}`;
const summary = (n: number): CardSummaryRow => ({
  cardNumber: pan(n), policyNumber: 1, companyXref: null, unitNumber: null, driverId: null,
  driverName: null, override: 0, beingOverridden: false, status: "Active",
  payrollStatus: null, infoSource: null, cardSubfleet: null,
});

/** `count` live mirror rows, numbered from 1 — the mirror as it stands before the sweep. */
const mirrorOf = (count: number, absent: (n: number) => string | null = () => null) =>
  Array.from({ length: count }, (_, i) => ({
    card_ref_hmac: cardRefHmac(env, ORG, pan(i + 1)),
    absent_since: absent(i + 1),
  }));

/** The roster EFS returned this sweep: cards 1..count. */
const rosterOf = (count: number) => Array.from({ length: count }, (_, i) => summary(i + 1));

/** Every `absent_since` value this sweep actually wrote — the destructive half. */
const marks = (rec: ReturnType<typeof createSupabaseRecorder>) =>
  rec.writtenRows("efs_cards").filter((r) => r.absent_since !== null && r.absent_since !== undefined);

describe("tombstoneAbsentCards — the ratio guard", () => {
  it("REFUSES a partial roster rather than tombstoning the fleet it did not mention", async () => {
    // The filed case: 199 live cards, a roster carrying 40. The old guard passed this — the roster
    // was non-empty — and stamped 159 live cards absent.
    const rec = createSupabaseRecorder({ tables: { efs_cards: mirrorOf(199) } });

    const result = await tombstoneAbsentCards(rec.client, env, ORG, rosterOf(40));

    expect(result.refused).toBe(true);
    expect(result.candidates).toBe(159);
    expect(result.tombstoned).toBe(0);
    // Not "fewer marks" — NONE. A guard that marks the first 39 and stops has still corrupted 39 rows.
    expect(marks(rec)).toHaveLength(0);
  });

  it("still marks a de-listing that is within the ceiling", async () => {
    // 199 live, roster of 190: nine cards genuinely gone. Under 20%, so it goes through — the guard
    // must not be a blanket refusal to ever tombstone anything, which is the lazy way to pass the
    // case above.
    const rec = createSupabaseRecorder({ tables: { efs_cards: mirrorOf(199) } });

    const result = await tombstoneAbsentCards(rec.client, env, ORG, rosterOf(190));

    expect(result.refused).toBe(false);
    expect(result.tombstoned).toBe(9);
    expect(marks(rec)).toHaveLength(1); // one `.in()` update carrying the nine hmacs
  });

  it("lets a small fleet lose its first card, where any single card is a large share", async () => {
    // QA runs 35 cards; one card is already 3%, and on a 10-card account it is 10%. Without the
    // floor the guard would refuse the first genuine removal on a small account and never let it
    // through — a guard that is always on is indistinguishable from the feature being absent.
    const rec = createSupabaseRecorder({ tables: { efs_cards: mirrorOf(10) } });

    const result = await tombstoneAbsentCards(rec.client, env, ORG, rosterOf(8));

    expect(result.refused).toBe(false);
    expect(result.tombstoned).toBe(2);
  });

  it("measures the share against LIVE cards, not against every row it holds", async () => {
    // 100 rows of which 80 are already absent. Counting all 100 would give a ceiling of 20 and let
    // this through; the 20 live cards make the real ceiling 5, and 6 disappearing at once is the
    // shape the guard is for. Getting this wrong makes the guard laxest on exactly the org that has
    // been losing cards.
    const rec = createSupabaseRecorder({
      tables: { efs_cards: mirrorOf(100, (n) => (n > 20 ? "2026-08-01T00:00:00.000Z" : null)) },
    });

    const result = await tombstoneAbsentCards(rec.client, env, ORG, rosterOf(14));

    expect(result.refused).toBe(true);
    expect(result.candidates).toBe(6);
    expect(marks(rec)).toHaveLength(0);
  });

  it("keeps the empty-roster guard that came before it", async () => {
    // The original audit P2 guard. The ratio guard would also refuse this, but through a different
    // branch — and an empty roster must touch nothing even if the ceiling were ever raised.
    const rec = createSupabaseRecorder({ tables: { efs_cards: mirrorOf(199) } });

    const result = await tombstoneAbsentCards(rec.client, env, ORG, []);

    expect(result).toEqual({ tombstoned: 0, candidates: 0, refused: false });
    expect(rec.writtenRows("efs_cards")).toHaveLength(0);
  });

  it("clears the mark from a card that came back, even in a sweep the guard refuses", async () => {
    // Recovery is deliberately NOT rate-limited. If a bad sweep has already marked cards absent, the
    // sweep that finds them again must be able to say so — a guard on the repair path leaves the
    // mirror stuck in whatever wrong state put it there.
    const rec = createSupabaseRecorder({
      tables: { efs_cards: mirrorOf(199, (n) => (n <= 3 ? "2026-08-01T00:00:00.000Z" : null)) },
    });

    // Cards 1–3 are back (and currently marked); 4–40 are present; 41–199 are missing → refused.
    const result = await tombstoneAbsentCards(rec.client, env, ORG, rosterOf(40));

    expect(result.refused).toBe(true);
    const cleared = rec.writtenRows("efs_cards").filter((r) => r.absent_since === null);
    expect(cleared).toHaveLength(1);
    expect(marks(rec)).toHaveLength(0);
  });
});
