import { describe, expect, it } from "vitest";
import { lockCardSchema, unlockCardSchema } from "@fuelguard/shared";
import type { Snapshot } from "../types.js";
import { cardLockBehaviour } from "./cardLock.behaviour.js";
import { cardUnlockBehaviour } from "./cardUnlock.behaviour.js";
import { statusIsRevertible, statusRevert } from "./statusRevert.js";

/**
 * The revert a proof run actually sends, judged by the schema that actually receives it.
 *
 * ── Why every case parses through the real schema ───────────────────────────────────────────────
 * The defect these cover was invisible to any assertion on the revert OBJECT: `{status: "INACTIVE"}`
 * is a perfectly good-looking body, and a test comparing it to `{status: "INACTIVE"}` would have
 * passed while the live run failed. It only becomes a defect at `prove.ts`'s `accept()` call, where
 * `lockCardSchema` — a case-SENSITIVE `z.enum(["Hold", "Inactive"])` — refuses it and the harness
 * throws with the card still changed.
 *
 * So the assertion is `safeParse(...).success`, on the same schema `accept()` uses, reached through
 * the same `revert()` the prover calls. Standing rule 6: the second independent route is the schema
 * itself, which no code in this file writes.
 *
 * ── The positive control ────────────────────────────────────────────────────────────────────────
 * `"Hold"` title-cased is asserted to pass in the same shape. Without it, a schema that refused
 * EVERYTHING would satisfy every case above it and the suite would be green for the wrong reason
 * (docs/35 §4.2).
 */

const snapAt = (status: string | null): Snapshot => ({ doc: { card: { status } } } as unknown as Snapshot);

/** Exactly what `prove.ts` does before dispatching a revert: fill the version, then `accept()`. */
const acceptedBy = (schema: typeof lockCardSchema | typeof unlockCardSchema, body: Record<string, unknown>) =>
  schema.safeParse({ ...body, expectedVersion: "0123456789abcdef" }).success;

/** This account's own spellings (incident 2026-08-12) — the input that broke it. */
const OBSERVED = ["INACTIVE", "HOLD", "inactive", "hold"] as const;

describe("the status a proof reverts to", () => {
  it.each(OBSERVED)("survives card_lock's schema when the account spelled it %s", (observed) => {
    const { capability, body } = statusRevert(snapAt(observed));

    expect(capability).toBe("card_lock");
    expect(acceptedBy(lockCardSchema, body)).toBe(true);
  });

  it.each(OBSERVED)("names the same status the card was at, not a default — %s", (observed) => {
    const { body } = statusRevert(snapAt(observed));

    // The canonical spelling of what was observed, never `Inactive` because the lookup missed. A
    // revert that quietly retired a card it had merely held would be worse than one that refused.
    expect(String(body.status).toLowerCase()).toBe(observed.toLowerCase());
  });

  it("routes an Active card through card_unlock, which carries no status at all", () => {
    const { capability, body } = statusRevert(snapAt("ACTIVE"));

    // `Active` is the one status card_lock may not write (audit P0-3), so this is not a preference —
    // there is no lock body that could express it.
    expect(capability).toBe("card_unlock");
    expect(body).not.toHaveProperty("status");
    expect(acceptedBy(unlockCardSchema, body)).toBe(true);
  });

  it("POSITIVE CONTROL: the documented spelling is accepted in the same shape", () => {
    // Without this, a schema that refused every input would make every case above pass.
    expect(acceptedBy(lockCardSchema, { status: "Hold" })).toBe(true);
    expect(acceptedBy(lockCardSchema, { status: "Inactive" })).toBe(true);
  });

  it("NEGATIVE CONTROL: the raw upper-case spelling really is refused", () => {
    // The defect itself, pinned. If this ever passes, `lockCardSchema` has been widened to accept
    // any casing and `statusRevert`'s whole reason for existing has quietly gone away.
    expect(acceptedBy(lockCardSchema, { status: "INACTIVE" })).toBe(false);
  });
});

describe("a card no capability can put back", () => {
  it.each(["FRAUD", "Deleted", null])("is refused by both status preconditions — %s", (status) => {
    expect(statusIsRevertible(status)).toBe(false);
    // Both would otherwise pass their own precondition (neither is Hold, neither is Active), write
    // to a real card, and then have no way home.
    expect(cardLockBehaviour.proof?.precondition(snapAt(status))).toBe(false);
    expect(cardUnlockBehaviour.proof?.precondition(snapAt(status))).toBe(false);
  });

  it("still lets the states that CAN be restored through", () => {
    // The other half of the pair: a precondition that refused everything would satisfy the case
    // above and make both capabilities permanently unprovable.
    expect(cardLockBehaviour.proof?.precondition(snapAt("ACTIVE"))).toBe(true);
    expect(cardLockBehaviour.proof?.precondition(snapAt("INACTIVE"))).toBe(true);
    expect(cardUnlockBehaviour.proof?.precondition(snapAt("HOLD"))).toBe(true);
    expect(cardUnlockBehaviour.proof?.precondition(snapAt("INACTIVE"))).toBe(true);
  });
});

describe("the revert body each behaviour hands the prover", () => {
  it.each([
    ["card_lock", cardLockBehaviour],
    ["card_unlock", cardUnlockBehaviour],
  ] as const)("is accepted by the capability it names — %s proved on an INACTIVE card", (_name, behaviour) => {
    const revert = behaviour.proof!.revert(snapAt("INACTIVE"));

    expect(revert.capability).toBe("card_lock");
    // `expectedVersion` is overwritten by the harness from a fresh read; what matters here is that
    // the STATUS survives the parse, which before 2026-08-16 it did not.
    expect(acceptedBy(lockCardSchema, revert.body as Record<string, unknown>)).toBe(true);
  });
});
