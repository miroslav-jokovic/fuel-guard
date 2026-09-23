import { describe, expect, it } from "vitest";
import type { CardDocument } from "../lib/efsCardXml.js";
import { EfsSoapError } from "../lib/efsSoapSession.js";
import { CardControlError } from "../services/efsCardControlErrors.js";
import { REVERT_ATTEMPTS, revertProof, type RevertIo } from "./proofRevert.js";

/**
 * Every branch of the revert loop, against scripted sends and reads. The version is the whole
 * decision, so a document here is only its version.
 */

const doc = (version: string) => ({ version }) as CardDocument;
const BEFORE = doc("v-before");
const CHANGED = doc("v-changed");
const ELSEWHERE = doc("v-someone-else");

const readTimeout = () => new EfsSoapError("EFS did not answer the getCardv2 request within 10000 ms", "transport");
const moved = (currentVersion: string) =>
  new CardControlError("This card changed in EFS since the screen was drawn.", "card_state_changed", 409, { currentVersion });

type Step = { status: string } | Error;

/** Scripted IO that records what the loop asked for, so a test can say what was NOT sent. */
function io(sends: Step[], reads: (CardDocument | Error)[] = []) {
  const log = { sentFrom: [] as string[], reads: 0, pauses: 0 };
  const take = <T>(list: T[], what: string): T => {
    const next = list.shift();
    if (next === undefined) throw new Error(`test ran out of scripted ${what}`);
    return next;
  };
  const impl: RevertIo = {
    send: async (from) => {
      log.sentFrom.push(from.version);
      const next = take(sends, "sends");
      if (next instanceof Error) throw next;
      return next;
    },
    read: async () => {
      log.reads += 1;
      const next = take(reads, "reads");
      if (next instanceof Error) throw next;
      return next;
    },
    pause: async () => { log.pauses += 1; },
  };
  return { impl, log };
}

describe("revertProof", () => {
  it("retries a revert whose read timed out, and lands on the second attempt (the ••••6122 case)", async () => {
    const { impl, log } = io([readTimeout(), { status: "succeeded" }]);
    const result = await revertProof(BEFORE, CHANGED, impl, 0);

    expect(result.landed).toBe(true);
    expect(log.sentFrom).toEqual(["v-changed", "v-changed"]);
    expect(log.pauses).toBe(1);
    expect(result.notes).toEqual([expect.stringMatching(/^revert attempt 1: revert threw: .*did not answer/)]);
  });

  it("gives up after REVERT_ATTEMPTS and says what each attempt saw", async () => {
    const { impl, log } = io(Array.from({ length: REVERT_ATTEMPTS }, readTimeout));
    const result = await revertProof(BEFORE, CHANGED, impl, 0);

    expect(result.landed).toBe(false);
    expect(log.sentFrom).toHaveLength(REVERT_ATTEMPTS);
    expect(result.notes).toHaveLength(REVERT_ATTEMPTS);
  });

  it("counts a 409 that finds the card back at its before-state as landed, and sends nothing more", async () => {
    // An earlier attempt's write went out and landed late. Writing again would be a second write.
    const { impl, log } = io([{ status: "sent" }, moved("v-before")], [CHANGED]);
    const result = await revertProof(BEFORE, CHANGED, impl, 0);

    expect(result.landed).toBe(true);
    expect(log.sentFrom).toEqual(["v-changed", "v-changed"]);
  });

  it("re-reads after a revert that went out unconfirmed, and stops sending once the card reads as before", async () => {
    const { impl, log } = io([{ status: "sent" }], [BEFORE]);
    const result = await revertProof(BEFORE, CHANGED, impl, 0);

    expect(result.landed).toBe(true);
    expect(log.sentFrom).toEqual(["v-changed"]);
    expect(log.reads).toBe(1);
  });

  it("never writes over a third state: someone else changed the card mid-proof", async () => {
    const { impl, log } = io([{ status: "failed" }], [ELSEWHERE]);
    const result = await revertProof(BEFORE, CHANGED, impl, 0);

    expect(result.landed).toBe(false);
    expect(log.sentFrom).toEqual(["v-changed"]);
    expect(result.notes.at(-1)).toMatch(/changed in EFS during the proof/);
  });

  it("stops on a 409 naming a third state, without retrying", async () => {
    const { impl, log } = io([moved("v-someone-else")]);
    const result = await revertProof(BEFORE, CHANGED, impl, 0);

    expect(result.landed).toBe(false);
    expect(log.sentFrom).toHaveLength(1);
    expect(log.pauses).toBe(0);
  });

  it("stops at once on a refusal that is a decision, not a fault", async () => {
    // Another operator's write in flight is exactly what must make a human look, not a loop wait.
    const inFlight = new CardControlError("Another change to this card is still being confirmed.", "mutation_in_flight", 409);
    const { impl, log } = io([inFlight]);
    const result = await revertProof(BEFORE, CHANGED, impl, 0);

    expect(result.landed).toBe(false);
    expect(log.sentFrom).toHaveLength(1);
    expect(result.notes[0]).toMatch(/still being confirmed/);
  });

  it("reads the card itself when OEG-4's read failed, rather than reverting against the before-state", async () => {
    // Sending from `before` expects the before version, and the plan refuses it as soon as the apply
    // has landed, so that revert could never land.
    const { impl, log } = io([{ status: "succeeded" }], [CHANGED]);
    const result = await revertProof(BEFORE, null, impl, 0);

    expect(result.landed).toBe(true);
    expect(log.sentFrom).toEqual(["v-changed"]);
  });

  it("retries a failed read too, and does not send until it knows where the card is", async () => {
    const { impl, log } = io([{ status: "succeeded" }], [readTimeout(), CHANGED]);
    const result = await revertProof(BEFORE, null, impl, 0);

    expect(result.landed).toBe(true);
    expect(log.reads).toBe(2);
    expect(log.sentFrom).toEqual(["v-changed"]);
  });

  it("sends nothing when the card already reads as before: the apply never landed", async () => {
    const { impl, log } = io([], []);
    const result = await revertProof(BEFORE, doc("v-before"), impl, 0);

    expect(result.landed).toBe(true);
    expect(log.sentFrom).toEqual([]);
  });
});
