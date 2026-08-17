import type { EfsMileageCode } from "@fuelguard/shared";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { type CardOpOptions, callCardOp, el } from "./efsCardOps.js";

/**
 * `overrideLastMileage` — the first write in this integration that is not keyed on a card
 * (`docs/37` §4, §6 E′).
 *
 * ── Why this is a file of its own ───────────────────────────────────────────────────────────────
 * Its read half, `getLastMileage`, lives in `efsAccountOps.ts`, and the obvious thing is to put the
 * write beside it. That file's header claims **"read-only, every one"**, and that claim is what
 * Step 7.2's no-probe-flag admin exposure rests on and why the account walk is safe to run against
 * production. One write would end the claim for all fifteen operations, so the seam is kept and a
 * test in `efsAccountOps.test.ts` now asserts it rather than trusting the next author to notice.
 *
 * ── What this operation does NOT tell you ───────────────────────────────────────────────────────
 * **The response message has no parts.** `CardManagementEP_overrideLastMileageResponse` is declared
 * empty in the checked-in WSDL — not an empty `<result>`, no elements at all. So unlike `setCardv2`,
 * there is nothing here to classify: no result text, no decline string, no document to diff. A
 * dispatch that returns is a dispatch that was ACCEPTED, which is a strictly weaker fact than a
 * write that landed, and this function deliberately returns `void` so no caller can mistake the one
 * for the other.
 *
 * **Landing is judged by re-reading `getLastMileage`.** That is not a belt-and-braces extra; it is
 * the only evidence that exists. `services/efsMileageOverride.ts` is the caller that owns it, and
 * the WEX portal does the same three beats by hand — search, edit, and the list showing the new
 * value (`docs/37` §3a).
 *
 * ── `retry: false`, for the reason `efsCardWrite.ts` states and one more ────────────────────────
 * A timed-out write may have landed, so a retry is a second write. For a mileage override the second
 * write is harmless in isolation — setting the reading to 258536 twice leaves it at 258536 — but the
 * value is not always the same by the time a retry fires, and more importantly the rule is worth
 * keeping unconditional: the moment one write in this codebase retries "because it is idempotent",
 * the next author has a precedent to reason from. The parameter is not exposed.
 *
 * The session retry inside `callCardOp` is unaffected and remains safe: EFS rejects an expired
 * clientId before doing anything with the request, so the first attempt provably did not land.
 */
export async function overrideLastMileage(
  env: Env,
  creds: EfsSoapCredentials,
  target: { unit: string; code: EfsMileageCode; mileage: number },
  opts: Omit<CardOpOptions, "retry"> = {},
): Promise<void> {
  await callCardOp(
    env, creds, "overrideLastMileage",
    (session) =>
      `<CardManagementEP_overrideLastMileage>${el("clientId", session.clientId)}`
      // `parameterOrder="clientId unit code mileage"`, in the WSDL's order. Axis2 is positional
      // enough about this that a reordered body is a dispatch fault rather than a helpful message.
      + `${el("unit", target.unit)}${el("code", target.code)}${el("mileage", target.mileage)}`
      + `</CardManagementEP_overrideLastMileage>`,
    {
      // A person is waiting on this one — it is an operator correcting a truck that cannot fuel.
      priority: opts.priority ?? "interactive",
      ...opts,
      retry: false,
    },
  );
}
