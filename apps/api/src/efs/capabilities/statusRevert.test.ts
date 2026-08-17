import type { EditsCtx } from "../types.js";
import { EFS_EDITABLE_INFO_IDS } from "@fuelguard/shared";
import { describe, expect, it } from "vitest";
import { deactivateCardSchema, lockCardSchema, unlockCardSchema } from "@fuelguard/shared";
import type { z } from "zod";
import type { Snapshot } from "../types.js";
import { cardDeactivateBehaviour } from "./cardDeactivate.behaviour.js";
import { cardLockBehaviour } from "./cardLock.behaviour.js";
import { cardUnlockBehaviour } from "./cardUnlock.behaviour.js";
import { statusIsRevertible, statusRevert } from "./statusRevert.js";

/**
 * The status capabilities ignore the editable prompt set entirely — their proofs are about
 * `status` — so any value serves. Passing the DRID/UNIT fallback rather than an empty list keeps it
 * honest: that is what an org whose vocabulary has never been read actually resolves to.
 */
const PROOF_CTX: EditsCtx = { editableInfoIds: [...EFS_EDITABLE_INFO_IDS] };


/**
 * The revert a proof run actually sends, judged by the schema that actually receives it.
 *
 * ── Why every case parses through the real schema ───────────────────────────────────────────────
 * The defect these cover was invisible to any assertion on the revert OBJECT: `{status: "INACTIVE"}`
 * is a perfectly good-looking body, and a test comparing it to `{status: "INACTIVE"}` would have
 * passed while the live run failed. It only becomes a defect at `prove.ts`'s `accept()` call, where
 * a case-SENSITIVE `z.enum` refuses it and the harness throws with the card still changed.
 *
 * So the assertion is `safeParse(...).success`, on the same schema `accept()` uses, reached through
 * the same `revert()` the prover calls. Standing rule 6: the second independent route is the schema
 * itself, which no code in this file writes.
 *
 * ── The controls ────────────────────────────────────────────────────────────────────────────────
 * A positive control asserts the documented spelling passes and a negative one asserts the raw
 * upper-case spelling is still refused. Without the pair, a schema that accepted everything — or one
 * that refused everything — would make the table above it green for the wrong reason (docs/35 §4.2).
 */

const snapAt = (status: string | null): Snapshot => ({ doc: { card: { status } } } as unknown as Snapshot);

/** Exactly what `prove.ts` does before dispatching a revert: fill the version, then `accept()`. */
const acceptedBy = (schema: z.ZodTypeAny, body: Record<string, unknown>) =>
  schema.safeParse({ ...body, expectedVersion: "0123456789abcdef" }).success;

/**
 * One row per status a card can rest at, in the account's OWN casing and the guide's.
 *
 * Since Step 8.1 each of the three has exactly one capability that writes it, and two of the three
 * carry no status field at all — which is what makes the P0-3 separation structural rather than
 * validated. `carriesStatus` is therefore part of the expectation, not an implementation detail.
 */
const ROUTES = [
  { observed: "HOLD", capability: "card_lock", schema: lockCardSchema, carriesStatus: true },
  { observed: "hold", capability: "card_lock", schema: lockCardSchema, carriesStatus: true },
  { observed: "Hold", capability: "card_lock", schema: lockCardSchema, carriesStatus: true },
  { observed: "INACTIVE", capability: "card_deactivate", schema: deactivateCardSchema, carriesStatus: false },
  { observed: "inactive", capability: "card_deactivate", schema: deactivateCardSchema, carriesStatus: false },
  { observed: "ACTIVE", capability: "card_unlock", schema: unlockCardSchema, carriesStatus: false },
  { observed: "active", capability: "card_unlock", schema: unlockCardSchema, carriesStatus: false },
] as const;

describe("the status a proof reverts to", () => {
  it("covers all three capabilities — without this the table below could route everything one way", () => {
    expect(new Set(ROUTES.map((r) => r.capability)).size).toBe(3);
  });

  it.each(ROUTES)("routes $observed to $capability, and its own schema accepts the body", (route) => {
    const { capability, body } = statusRevert(snapAt(route.observed));

    expect(capability).toBe(route.capability);
    expect(acceptedBy(route.schema, body)).toBe(true);
  });

  it.each(ROUTES)("sends $observed's status only when the capability has one to send", (route) => {
    const { body } = statusRevert(snapAt(route.observed));

    if (!route.carriesStatus) {
      // `card_unlock` and `card_deactivate` each write exactly one status and carry none, so there
      // is no field here to get the casing wrong in.
      expect(body).not.toHaveProperty("status");
      return;
    }
    // The canonical spelling of what was observed, never a default. A revert that quietly retired a
    // card it had merely held would be worse than one that refused.
    expect(String(body.status).toLowerCase()).toBe(route.observed.toLowerCase());
  });

  it("POSITIVE CONTROL: the documented spelling is accepted in the same shape", () => {
    // Without this, a schema that refused every input would make every case above pass.
    expect(acceptedBy(lockCardSchema, { status: "Hold" })).toBe(true);
    expect(acceptedBy(deactivateCardSchema, {})).toBe(true);
  });

  it("NEGATIVE CONTROL: the raw upper-case spelling really is refused", () => {
    // The original defect, pinned. If this ever passes, `lockCardSchema` has been widened to accept
    // any casing and `statusRevert`'s whole reason for existing has quietly gone away.
    expect(acceptedBy(lockCardSchema, { status: "HOLD" })).toBe(false);
    // And the Step 8.1 half: `Inactive` is not lock's to write at all any more.
    expect(acceptedBy(lockCardSchema, { status: "Inactive" })).toBe(false);
  });
});

describe("a card no capability can put back", () => {
  it.each(["FRAUD", "Deleted", null])("is refused by every status precondition — %s", (status) => {
    expect(statusIsRevertible(status)).toBe(false);
    // All three would otherwise pass their own precondition — none of these is Hold, Active or
    // Inactive — then write to a real card and have no way home.
    expect(cardLockBehaviour.proof?.precondition(snapAt(status), PROOF_CTX)).toBe(false);
    expect(cardUnlockBehaviour.proof?.precondition(snapAt(status), PROOF_CTX)).toBe(false);
    expect(cardDeactivateBehaviour.proof?.precondition(snapAt(status), PROOF_CTX)).toBe(false);
  });

  it("still lets the states that CAN be restored through", () => {
    // The other half of the pair: a precondition that refused everything would satisfy the case
    // above and make all three capabilities permanently unprovable.
    expect(cardLockBehaviour.proof?.precondition(snapAt("ACTIVE"), PROOF_CTX)).toBe(true);
    expect(cardLockBehaviour.proof?.precondition(snapAt("INACTIVE"), PROOF_CTX)).toBe(true);
    expect(cardUnlockBehaviour.proof?.precondition(snapAt("HOLD"), PROOF_CTX)).toBe(true);
    expect(cardDeactivateBehaviour.proof?.precondition(snapAt("HOLD"), PROOF_CTX)).toBe(true);
  });
});

describe("the revert body each behaviour hands the prover", () => {
  const BEHAVIOURS = [
    ["card_lock", cardLockBehaviour],
    ["card_unlock", cardUnlockBehaviour],
    ["card_deactivate", cardDeactivateBehaviour],
  ] as const;

  it.each(BEHAVIOURS)("%s, proved on a card resting at INACTIVE, reverts through card_deactivate", (_n, behaviour) => {
    const revert = behaviour.proof!.revert(snapAt("INACTIVE"), PROOF_CTX);

    expect(revert.capability).toBe("card_deactivate");
    expect(acceptedBy(deactivateCardSchema, revert.body as Record<string, unknown>)).toBe(true);
  });

  it.each(BEHAVIOURS)("%s, proved on a card resting at HOLD, reverts through card_lock", (_n, behaviour) => {
    const revert = behaviour.proof!.revert(snapAt("HOLD"), PROOF_CTX);

    expect(revert.capability).toBe("card_lock");
    // The case that started this: `HOLD` verbatim is refused here, `Hold` is not.
    expect(acceptedBy(lockCardSchema, revert.body as Record<string, unknown>)).toBe(true);
  });
});
