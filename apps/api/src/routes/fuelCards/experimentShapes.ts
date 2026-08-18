import { z } from "zod";
import { EXPERIMENT_VARIANTS } from "../../lib/efsCardExperiments.js";

/**
 * The card-experiment REQUEST SHAPES and the READING SHAPES its transcripts are made of.
 *
 * Split out of `experiments.ts` when Step 10.4's product-limit fields pushed that file 65 lines past
 * the size it is WAIVED at — and the gate's own words are the reason this is a cut rather than a
 * bumped number: *"a waiver is permission to be big, not permission to keep growing."*
 *
 * The seam is a real one. Everything here describes WHAT a drill may ask for and WHAT one look at
 * the card records; everything left behind performs the writes, schedules the re-reads and decides.
 * The two change for different reasons — a new hypothesis adds a shape here, a new safety rail
 * changes the handler there.
 */

/**
 * ⚠ A card is named by NUMBER or by `efs_cards.id`, and the uuid is the better of the two.
 *
 * Last four digits do not identify a QA card — 35 cards share 20 last-4 values and six groups hold
 * three cards each (docs/28 Step 0.13) — so "the 7672 card" is not a thing, and on 2026-08-18 that
 * ambiguity sent a drill at the wrong card twice. A uuid is exact, it is org-scoped when resolved
 * through `loadCardNumber`, and unlike a PAN it may safely appear in shell history and a transcript
 * (rule 13). Exactly one of the two must be given; the handler refuses both and neither.
 */
export const experimentSchema = z.discriminatedUnion("experiment", [
  z.object({
    experiment: z.literal("read_state"),
    cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/).optional(),
    efsCardId: z.string().uuid().optional(),
  }),
  z.object({
    experiment: z.literal("set_status"),
    cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/).optional(),
    efsCardId: z.string().uuid().optional(),
    /** Sent VERBATIM — casing is hypothesis H1. Allowlist enforced below with a readable error. */
    status: z.string().trim().min(1),
    /**
     * Opt in to production's OWN casing rule (`matchStatusCasing`) instead of the verbatim default.
     *
     * The default has to stay verbatim: casing IS hypothesis H1, and an endpoint that quietly
     * corrected it could never have measured it. But that default made this endpoint unusable for
     * asking a question ABOUT SOMETHING ELSE — the F9 run on 2026-08-17 sent `Hold` to an account
     * that stores `ACTIVE`, reproduced H1's accepted-and-ignored exactly, and could not tell that
     * apart from the override freeze it was trying to measure. One uncontrolled variable, already
     * proven sufficient on its own to produce the observed result.
     *
     * Applied SERVER-SIDE from the document in hand, so the rule stays single-sourced — a CLI that
     * recomputed it would be a second implementation of the thing H1 cost us.
     */
    matchAccountCasing: z.boolean().default(false),
    /**
     * Also disarm the override, in the SAME request as the status — the H16 follow-up.
     *
     * H16 proved a status-only write is ignored while an override is armed, and that an override-only
     * clear lands. It never tested a request carrying BOTH, so whether EFS evaluates the status
     * against the pre- or post-clear state is unknown — and `card_lock`'s `clearException` now sends
     * exactly that combination in production. This answers it against the same bytes.
     */
    clearOverride: z.boolean().default(false),
    variant: z.enum(EXPERIMENT_VARIANTS).default("standard"),
    /** Hypothesis H3. Only meaningful alongside a Hold; the vendor decides what it does with it. */
    setOriginalStatus: z.string().trim().min(1).optional(),
    confirm: z.string().trim(),
  }),
  // ── D1 pair: grant an override, then delete it with the dedicated op ──────────────────────────
  z.object({
    experiment: z.literal("set_override"),
    cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/).optional(),
    efsCardId: z.string().uuid().optional(),
    /** Vendor range (p194). The experiment grants the smallest useful state; 1 is the default ask. */
    uses: z.coerce.number().int().min(1).max(9).default(1),
    /** A 6-digit EFS location id makes it a single-location override; absent = all locations. */
    locationId: z.string().trim().regex(/^[0-9]{1,7}$/).optional(),
    /**
     * Step 10.4's whole question. Empty keeps this the scope-only D1 grant it has always been.
     *
     * p194's product recipe REMOVES the card's own limits and puts the override's in their place, and
     * nothing in the guide promises EFS gives the originals back when the exception clears. `docs/38`
     * §1.2 calls that a precondition for shipping rather than a closing check: if the vendor does not
     * restore them, a temporary exception has permanently altered a card. This is the instrument that
     * asks, and `limitsBefore` in the response is what makes the answer survivable either way.
     */
    limits: z.array(z.object({
      limitId: z.string().trim().regex(/^[A-Z0-9]{1,10}$/),
      limit: z.coerce.number().int().min(0).max(9999),
      hours: z.coerce.number().int().min(0).max(999).default(1),
      minHours: z.coerce.number().int().min(0).max(999).default(0),
    })).max(10).default([]),
    confirm: z.string().trim(),
  }),
  z.object({
    experiment: z.literal("delete_override"),
    cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/).optional(),
    efsCardId: z.string().uuid().optional(),
    confirm: z.string().trim(),
  }),
  /** The production FALLBACK mechanism (three-field echo clear) as an experiment: the cleanup path
   *  when delete_override turns out unentitled, and the baseline the dedicated op is compared to. */
  z.object({
    experiment: z.literal("clear_override"),
    cardNumber: z.string().trim().regex(/^[0-9]{10,25}$/).optional(),
    efsCardId: z.string().uuid().optional(),
    confirm: z.string().trim(),
  }),
]);

/** Re-read schedule after the write, in ms after the previous read. Three looks, ~8s total: enough
 *  to catch a replication-lagged apply (H2) without turning the endpoint into a poller. */
export const VERIFY_DELAYS_MS = [0, 3_000, 5_000] as const;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface VerifyReading {
  atMsAfterWrite: number;
  version: string;
  /** Verbatim vendor casing — the reading IS the data here. */
  status: string | null;
  /** F9: a `landed: false` is evidence about overrides only if one was armed AT THIS INSTANT. */
  overrideUses: number | null;
  landed: boolean;
}

/** One verifying look at the override trio. What EFS sets them to after `deleteOverride` — 0, nil,
 *  absent — is exactly what the D1 experiments exist to record (fix plan D1 step 2). */
export interface OverrideReading {
  atMsAfterWrite: number;
  version: string;
  overrideUses: number | null;
  overrideAllLocations: boolean | null;
  locationOverrideId: string | null;
  landed: boolean;
  /**
   * The card's product limits AT THIS READING — Step 10.4's evidence, on every look.
   *
   * Recorded on the clear path as much as the grant path, because the question is not "did the
   * override's limits land" but "did the card's ORIGINAL limits come back afterwards". Only a
   * before/after/after triple answers that, and a reading that omitted them could not.
   */
  limits: LimitReading[];
}

/** The four fields p194's override record carries — the ones a restore has to bring back. */
export interface LimitReading {
  limitId: string | null;
  limit: number | null;
  hours: number | null;
  minHours: number | null;
}

/** One card's limits, flattened for a transcript a human reads next to `before.limits`. */
export function readLimits(card: { limits: readonly LimitReading[] }): LimitReading[] {
  return card.limits.map((l) => ({
    limitId: l.limitId,
    limit: l.limit,
    hours: l.hours,
    minHours: l.minHours,
  }));
}
