import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARD_LOCK_OVERRIDE_BLOCKED, type CardLockBody } from "@silvicom/shared";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { ActionRefusalError } from "../services/efsCardControlErrors.js";
import type { Snapshot } from "../types.js";
import { cardLockBehaviour } from "./cardLock.behaviour.js";
import { assertOverrideDoesNotBlock } from "./overrideFreezeGuard.js";

/**
 * The override freeze, from the capability's side (docs/22 H16).
 *
 * H16 proved live that an armed override makes EFS silently ignore a status change, with NO signal at
 * the response layer — `responseShape: empty`, no fault, indistinguishable from success. So every case
 * here is about refusing or clearing BEFORE the dispatch, because after it the vendor tells us nothing.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");
const doc = (name: string) => parseCardDocument(fixture(name));

/** `getCardV2.overridden.xml` carries `<override>2</override>`; `full.xml` carries `0`. */
const ARMED = () => ({ doc: doc("getCardV2.overridden.xml") }) as unknown as Snapshot;
const QUIET = () => ({ doc: doc("getCardV2.full.xml") }) as unknown as Snapshot;

const body = (over: Partial<CardLockBody> = {}): CardLockBody =>
  ({ status: "Hold", clearException: false, expectedVersion: "", ...over });

const precondition = (snap: Snapshot, b: CardLockBody) =>
  () => cardLockBehaviour.precondition?.({ env: {}, stepUp: false } as never, snap, b);

const editNames = (snap: Snapshot, b: CardLockBody): string[] => {
  const mutation = cardLockBehaviour.mutation;
  if (mutation.kind !== "echo") throw new Error("card_lock is an echo write");
  return mutation.buildEdits(snap.doc!, b, {} as never).map((e) => e.name);
};

describe("card_lock on a card carrying a fuel exception", () => {
  it("refuses rather than dispatching a write EFS would silently swallow", () => {
    expect(precondition(ARMED(), body())).toThrow(ActionRefusalError);
    expect(precondition(ARMED(), body())).toThrow(CARD_LOCK_OVERRIDE_BLOCKED);
  });

  it("refuses with `invalid_request`, NOT `step_up_required` — locking must never demand a password", () => {
    // Decision B1 and the CAPABILITIES_WITH_STEP_UP_GATE comment: locking is the 2am safety action and
    // friction there costs stolen fuel. A password prompt here would be a regression, and the shared
    // pin is split precisely so this refusal cannot quietly become one.
    try {
      cardLockBehaviour.precondition?.({ env: {}, stepUp: false } as never, ARMED(), body());
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ActionRefusalError);
      expect((error as ActionRefusalError).code).toBe("invalid_request");
    }
  });

  it("says what to do about it, and does not send the operator elsewhere", () => {
    // The lock's sentence differs from the other four ON PURPOSE: this capability can remove the
    // exception itself, so "remove the exception first, then try again" would be false here.
    expect(CARD_LOCK_OVERRIDE_BLOCKED).toContain("Confirm removing the exception");
    expect(CARD_LOCK_OVERRIDE_BLOCKED).not.toContain("try again");
  });

  it("allows the lock through when the operator asked for the exception to go too", () => {
    expect(precondition(ARMED(), body({ clearException: true }))).not.toThrow();
  });

  it("sends the exception out in the SAME write as the status", () => {
    const names = editNames(ARMED(), body({ clearException: true }));
    expect(names).toContain("status");
    // The p194 trio, all three, because overrideClearEdits writes them unconditionally.
    expect(names).toContain("override");
    expect(names).toContain("overrideAllLocations");
    expect(names).toContain("locationOverride");
  });

  it("cannot be inferred — `clearException` false leaves the exception alone even though the write will fail", () => {
    // The `allowRemoveDriverId` rule: destroying something the operator did not ask about is not made
    // safe by it being the only way forward. The precondition above is what stops the doomed dispatch.
    expect(editNames(ARMED(), body())).toEqual(["status"]);
  });
});

describe("an ordinary lock is completely unchanged", () => {
  it("does not refuse, and writes exactly one field", () => {
    // The 99% case, and the reason this is not a two-step sequence: a sequence would have cost every
    // caller an extra vendor call and re-read on the 2am path to serve the card-with-an-exception case.
    expect(precondition(QUIET(), body())).not.toThrow();
    expect(editNames(QUIET(), body())).toEqual(["status"]);
  });

  it("does not clear an override that is not there, even when asked to", () => {
    // `clearException` is permission, not an instruction. Writing the trio on a card with no exception
    // would put three no-op edits in the ledger and invite the reader to explain them.
    expect(editNames(QUIET(), body({ clearException: true }))).toEqual(["status"]);
  });

  it("is void for a proof run on a card in override, rather than reported as a broken capability", () => {
    // Without this, the prover's status write would be swallowed, the run would read `not_landed`, and
    // the safest capability in the product would look unprovable on this account.
    expect(cardLockBehaviour.proof?.precondition?.(ARMED(), {} as never)).toBe(false);
    expect(cardLockBehaviour.proof?.sample?.(ARMED(), {} as never).clearException).toBe(false);
  });
});

describe("the shared guard, for the four capabilities that get no way through", () => {
  it("names the count and tells the operator to remove it first", () => {
    expect(() => assertOverrideDoesNotBlock("prompts_set", ARMED()))
      .toThrow(/2 purchases left.*a prompt change.*Remove the exception first/s);
  });

  it("is silent on a card with no exception — the whole fleet's ordinary case", () => {
    expect(() => assertOverrideDoesNotBlock("prompts_set", QUIET())).not.toThrow();
  });

  it("fails CLOSED for a capability nobody has decided about", () => {
    // Being wrong here is SILENT — that is the whole of H16 — so an unmapped capability refuses with a
    // generic noun rather than being waved through into the accepted-and-ignored.
    expect(() => assertOverrideDoesNotBlock("some_future_capability", ARMED()))
      .toThrow(/this change/);
  });

  it("does NOT refuse when the document could not be read", () => {
    // `plan` owns the failed-read path. Refusing here would turn a vendor blip into a claim about the
    // card — "this card has an exception" — which is a different and unfounded sentence.
    expect(() => assertOverrideDoesNotBlock("prompts_set", { doc: null } as unknown as Snapshot))
      .not.toThrow();
  });
});
