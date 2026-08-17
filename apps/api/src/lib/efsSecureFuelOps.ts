import {
  type EfsMileageCode,
  type WsLastMileage,
  wsLastMileageSchema,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { bool, parseOne, payload } from "./efsAccountOps.js";
import { type CardOpOptions, callCardOp, el, elAlways, resultRecords, text } from "./efsCardOps.js";

/**
 * Odometer following and SecureFuel — the three operations, read and write together (`docs/37` §6).
 *
 * One feature, one file. `doesCardPosition` and `getLastMileage` are account-scoped reads and were
 * added to `efsAccountOps.ts` first, which is where every rule that file states puts them; they
 * took it past the 500-line budget and `lint:filesize` refused the build. Splitting them out turned
 * out to be the better shape regardless — a reader asking "how does odometer following work" opens
 * this file instead of three, and the write that the two reads exist to serve is the third.
 *
 * `payload`, `parseOne` and `bool` are imported from `efsAccountOps.ts` rather than copied, the same
 * arrangement `efsCardOps.ts` uses for `callCardOp`/`resultRecords`/`text`.
 *
 * ── ⚠ This file is NOT read-only, and that is the whole reason it is a boundary ─────────────────
 * `efsAccountOps.ts` claims "read-only, every one", and that claim is what lets Step 7.2 expose the
 * account walk behind an admin route with no probe flag. `overrideLastMileage` would have ended it
 * for all thirteen operations there. Here the write is expected, declared at the top, and the
 * account module has a test asserting it never acquires one.
 *
 * ── The wire values, because the portal shows different ones ────────────────────────────────────
 * `code` is `ODRD` (odometer) or `HBRD` (hubometer). The WEX portal DISPLAYS the first as
 * "odometer" (`docs/37` §3a) — that label is not a wire value, and sending it would be dispatched
 * into an operation that returns nothing to say it was wrong. `EFS_MILEAGE_CODES` is closed for
 * exactly that reason.
 */

// ─── doesCardPosition ──────────────────────────────────────────────────────────────────────────

/**
 * Whether this account uses SecureFuel at all (`docs/37` §6 A).
 *
 * > *"This method will return if the customer uses secure fuel. If has secure fuel rules of 1 or 2
 * > and a member type of customer, this will return true."* (guide p30)
 *
 * The cheapest question in the inventory and the one that gates every other odometer question: on an
 * account that answers false, the accrual window, the stored mileage and the override are all
 * inert. Asking it costs one call and no parameters beyond the session.
 *
 * ⚠ Response part is `doesCardPosition`, not `result` — read from
 * `<message name="CardManagementEP_doesCardPositionResponse"><part name="doesCardPosition">` in the
 * checked-in WSDL. A fourth operation joins the three named in this file's header.
 *
 * ⚠ It does NOT say WHICH of the two rules applies, and the guide gives no operation that does. That
 * is open question 2 in `docs/37` §7 — one rule may be odometer-only and the other add position, and
 * the difference decides what this product can honestly tell an operator about a decline.
 */
export async function doesCardPosition(
  env: Env,
  creds: EfsSoapCredentials,
  opts: CardOpOptions = {},
): Promise<boolean | null> {
  const xml = await callCardOp(
    env, creds, "doesCardPosition",
    (session) => `<CardManagementEP_doesCardPosition>${el("clientId", session.clientId)}</CardManagementEP_doesCardPosition>`,
    { priority: "backfill", ...opts },
  );
  return bool((payload(xml, "doesCardPosition").textContent ?? "").trim());
}

// ─── getLastMileage ────────────────────────────────────────────────────────────────────────────

/**
 * The odometer or hubometer reading EFS holds, per UNIT (`docs/37` §6 D).
 *
 * The reading a SecureFuel account compares the driver's pump entry against, and the state
 * `overrideLastMileage` corrects. It is also the ONLY way to judge whether that override landed:
 * the write's response message has no parts at all (`docs/37` §3), so this read is the verification.
 *
 * ── The `search` wrapper is READ, not guessed ───────────────────────────────────────────────────
 * `efsLocationSearch.ts` had to discover its wrapper by trying shapes against the live binding and
 * remembering which one ADB accepted — the WSDL was not available when it was written. It is now:
 * `<message name="CardManagementEP_getLastMileage"><part name="search" type="ns2:WSLastMileageSearch">`.
 * The element is `search`, on the vendor's own authority, so no shape ladder is needed here.
 *
 * ── One `WSLastMileageSearch`, not an array ─────────────────────────────────────────────────────
 * The guide says *"Search Array, 1 to many"* (p84) and the WSDL declares a single
 * `WSLastMileageSearch` with no `…SearchArray` type anywhere in it. The WSDL wins, as it has in five
 * prior discrepancies. `docs/37` §7 question 3 is whether the binding nonetheless accepts repeats;
 * until that is probed, one unit per call.
 *
 * ── Both criteria are sent even when empty, and that is what "All" means ────────────────────────
 * `elAlways`, per the rule this binding taught the transaction feeds: it "rejects omitted filter
 * elements even though the WSDL marks them nillable". Sending both empty is the wire equivalent of
 * the WEX portal's **All** radio, which returns every unit's row in one page — so a fleet-wide drift
 * comparison may cost one round trip rather than one per unit.
 *
 * ⚠ That last part is an INFERENCE from the portal's UI, not from the wire, and it is the first
 * thing to probe live. If empty criteria are refused rather than treated as "all", the caller must
 * pass a unit and the fleet view costs N calls — which changes what §6 D can afford, not whether it
 * works.
 *
 * ⚠ `code` on the wire is `ODRD` / `HBRD`. The portal DISPLAYS it as "odometer"; that label is not a
 * wire value, and sending it would be the same class of mistake as reading `M:1, X:1800` as a
 * string. `EFS_MILEAGE_CODES` is the closed set for exactly this reason.
 */
export async function getLastMileage(
  env: Env,
  creds: EfsSoapCredentials,
  search: { unit?: string | null; code?: EfsMileageCode | null } = {},
  opts: CardOpOptions = {},
): Promise<WsLastMileage[]> {
  const xml = await callCardOp(
    env, creds, "getLastMileage",
    (session) =>
      `<CardManagementEP_getLastMileage>${el("clientId", session.clientId)}`
      + `<search>${elAlways("unit", search.unit ?? "")}${elAlways("code", search.code ?? "")}</search>`
      + `</CardManagementEP_getLastMileage>`,
    { priority: "backfill", ...opts },
  );
  return resultRecords(payload(xml, "result")).map((e, i) => parseOne(wsLastMileageSchema, {
    unit: text(e, "unit"),
    code: text(e, "code"),
    mileage: text(e, "mileage"),
  }, `getLastMileage[${i}]`));
}

// ─── overrideLastMileage — THE WRITE ───────────────────────────────────────────────────────────

/**
 * `overrideLastMileage` — the first write in this integration that is not keyed on a card
 * (`docs/37` §4, §6 E′).
 *
 * The only operation in this file that changes anything, and the reason the file exists apart from
 * `efsAccountOps.ts`: that module claims "read-only, every one", the claim Step 7.2's
 * no-probe-flag admin exposure rests on, and one write would end it for all thirteen operations
 * there. A test in `efsAccountOps.test.ts` asserts it never acquires one.
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

