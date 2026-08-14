import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCardDocument } from "../lib/efsCardXml.js";
import { cardEchoVerify } from "./cardEchoVerify.js";
import type { CapabilityBehaviour, Mutation, Snapshot, Step } from "./types.js";

/**
 * docs/27 §7.3 claims four things are "enforced by types". A claim like that is worth exactly as much
 * as the check behind it, so this file is the check.
 *
 * The assertions below are TYPE-LEVEL: they cost nothing at runtime and fail `pnpm typecheck`, which
 * is how a type invariant should fail. Written as conditional types rather than `@ts-expect-error`
 * because an `@ts-expect-error` that stops being an error silently starts passing for the opposite
 * reason — it is the one weakening token this repo would not otherwise tolerate, and it is avoidable.
 */

type Expect<T extends true> = T;
/** True when `A` is assignable to `B`. */
type Assignable<A, B> = A extends B ? true : false;

interface Body {
  uses: number;
}

// ── verify is REQUIRED, so a capability cannot ship without a way to tell whether it landed ──────
type BehaviourMinusVerify = Omit<CapabilityBehaviour<Body>, "verify">;
type _VerifyIsRequired = Expect<Assignable<BehaviourMinusVerify, CapabilityBehaviour<Body>> extends true ? false : true>;

// ── sequence cannot nest: a Step's mutation excludes the sequence member ─────────────────────────
type NestedSequence = { kind: "sequence"; steps: readonly Step<Body>[] };
type _SequenceCannotNest = Expect<Assignable<NestedSequence, Step<Body>["mutation"]> extends true ? false : true>;
// …while the two non-nesting kinds remain perfectly legal in a step.
type EchoMutation = Extract<Mutation<Body>, { kind: "echo" }>;
type DirectMutation = Extract<Mutation<Body>, { kind: "direct" }>;
type _EchoIsAllowedInAStep = Expect<Assignable<EchoMutation, Step<Body>["mutation"]>>;
type _DirectIsAllowedInAStep = Expect<Assignable<DirectMutation, Step<Body>["mutation"]>>;

// ── a capability cannot construct its own dispatch opts: they arrive on the ctx it is handed ─────
// If `dispatch` ever took only a body, this would start passing and the retry:false / pacing-lane
// guarantee would quietly become per-capability discretion.
type BodyOnlyDispatch = { kind: "direct"; dispatch: (body: Body) => Promise<never> };
type _DispatchReceivesCtx = Expect<Assignable<BodyOnlyDispatch, Mutation<Body>> extends true ? false : true>;

/** Referenced so the compiler keeps the assertions above and `lint` does not read them as dead. */
export const TYPE_ASSERTIONS: readonly true[] = [
  true as _VerifyIsRequired,
  true as _SequenceCannotNest,
  true as _EchoIsAllowedInAStep,
  true as _DirectIsAllowedInAStep,
  true as _DispatchReceivesCtx,
];

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/efs/${name}`, import.meta.url)), "utf8");
const doc = (xml = fixture("getCardV2.full.xml")) => parseCardDocument(xml);
const snap = (d: ReturnType<typeof doc> | null): Snapshot => ({ doc: d });

describe("cardEchoVerify", () => {
  const verify = cardEchoVerify<{ status: string }>();
  const body = { status: "Hold" };

  it("says landed when the edited field actually moved", () => {
    const before = doc();
    const after = doc(fixture("getCardV2.full.xml").replace("<status>Active</status>", "<status>Hold</status>"));
    expect(verify.judge(snap(before), snap(after), body, [{ op: "setField", name: "status", value: "Hold" }]))
      .toBe("landed");
  });

  it("says not_landed when the card came back unchanged", () => {
    const before = doc();
    expect(verify.judge(snap(before), snap(doc()), body, [{ op: "setField", name: "status", value: "Hold" }]))
      .toBe("not_landed");
  });

  /**
   * The reason `Landing` is three-valued. A missing re-read is "we could not tell", which the
   * orchestrator answers with a second look — not "it did not land", which would report a write that
   * may well have succeeded as a failure and invite the operator to repeat it.
   */
  it("says indeterminate when the verifying re-read produced no document", () => {
    expect(verify.judge(snap(doc()), snap(null), body, [])).toBe("indeterminate");
  });

  it("says indeterminate when there was no before-document to compare against", () => {
    expect(verify.judge(snap(null), snap(doc()), body, [])).toBe("indeterminate");
  });
});
