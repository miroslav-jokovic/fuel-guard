import { assertEchoFidelity, serializeSetCardRequest, type CardEdit } from "../../lib/efsCardEcho.js";
import { parseCardDocument, type CardDocument } from "../../lib/efsCardXml.js";
import { resolveEditableInfoIds } from "@silvicom/shared";
import { capabilityRegistry } from "../registry.js";

/**
 * Replay a recorded card document through any capability and see the exact bytes it would send.
 *
 * Offline, synchronous, no vendor, no database, no HTTP server (Step 4.3). That is what makes it
 * runnable in CI on every commit, and what makes it usable at a keyboard: given a fixture and a
 * body, what does pressing this button actually put on the wire?
 *
 * ── What this covers that the characterisation suite does not ───────────────────────────────────
 * `fuelCardsControl.characterisation.test.ts` asserts route → dispatched bytes, and it earns its
 * keep — but it stands up an Express app, a Supabase recorder, a sealed credential and a scripted
 * SOAP session to do it. That cost is why it covers five hand-written cases and not a matrix. This
 * runs the same serializer and the same fidelity guard with none of the ceremony, so covering a new
 * capability × a new document shape is one line rather than a fixture rewrite.
 *
 * ── It runs the REAL guard, not a copy ──────────────────────────────────────────────────────────
 * `assertEchoFidelity` is called on the produced bytes exactly as `setCardV2` calls it, so a
 * serializer bug throws `echo_unfaithful` here — in CI, offline, before any card is touched. A
 * harness that skipped the guard would happily report the bytes of a request production would refuse
 * to send.
 */

/** Placeholders. A real clientId is a session token and a real card number is a PAN; neither belongs
 *  in a test fixture, and the serializer treats both as opaque strings. */
const REPLAY_CLIENT_ID = "replay-client-id";
const REPLAY_CARD_NUMBER = "70830000000000000";

export interface LocalReplay {
  /** The edits the capability produced from this document and body. */
  edits: CardEdit[];
  /** The exact `setCardv2` body, byte for byte. */
  requestXml: string;
  /** The same bytes with card numbers redacted — what the ledger would store. */
  redactedXml: string;
  /** The parsed document the replay ran against, so a caller can assert on the before-state too. */
  document: CardDocument;
}

export interface LocalReplayOptions {
  capabilityKey: string;
  /** A recorded `getCardv2` response — a checked-in fixture, or a redacted production document. */
  documentXml: string;
  body: unknown;
  clientId?: string;
  cardNumber?: string;
  /**
   * Step 9.1: the prompt ids editable on the account being replayed. Defaults to the DRID/UNIT
   * fallback — the same answer the orchestrator gives an org whose vocabulary has never been read —
   * so a replay that says nothing about prompts reproduces pre-Phase-9 behaviour exactly.
   *
   * Named here rather than resolved, because the harness is OFFLINE: it has a recorded document and
   * no database, and inventing an editable set from the document would make the replay's output a
   * function of the fixture rather than of the account.
   */
  editableInfoIds?: readonly string[];
}

/**
 * Build the request one capability would dispatch, from a recorded document.
 *
 * Throws rather than returning a partial result, in every case where the answer would be a guess:
 * an unknown capability, a body the contract refuses, or a capability that does not build edits at
 * all. A harness that returned empty bytes for a `direct` capability would read as "this capability
 * sends nothing", which is true of the request body and false of the operation.
 */
export function replayCapability(opts: LocalReplayOptions): LocalReplay {
  const capability = capabilityRegistry()[opts.capabilityKey];
  if (!capability) throw new Error(`local harness: no capability named "${opts.capabilityKey}"`);

  const document = parseCardDocument(opts.documentXml);

  // PARSED by the contract's own schema, never cast — the same validation the route performs, so a
  // body this harness accepts is one the API would have accepted too.
  const parsed = capability.contract.schema.safeParse({
    ...(opts.body as object),
    expectedVersion: document.version,
  });
  if (!parsed.success) {
    throw new Error(`local harness: ${opts.capabilityKey} refused the body: ${parsed.error.issues[0]?.message}`);
  }

  const mutation = capability.behaviourMutation;
  if (mutation.kind !== "echo") {
    throw new Error(
      `local harness: ${opts.capabilityKey} is a "${mutation.kind}" capability — it names a vendor `
        + "operation rather than echoing a document, so there are no setCardv2 bytes to replay.",
    );
  }

  const edits = mutation.buildEdits(document, parsed.data as never, {
    editableInfoIds: opts.editableInfoIds ?? resolveEditableInfoIds(null),
  });
  const { xml, redactedXml } = serializeSetCardRequest(
    document,
    { clientId: opts.clientId ?? REPLAY_CLIENT_ID, cardNumber: opts.cardNumber ?? REPLAY_CARD_NUMBER },
    edits,
  );

  // The real guard, on the real bytes, exactly where `setCardV2` runs it. Offline and in CI.
  assertEchoFidelity(document, xml, edits);

  return { edits, requestXml: xml, redactedXml, document };
}

/**
 * Every capability this harness can replay — the echo ones.
 *
 * Derived from the registry rather than listed, so the coverage assertion in `local.test.ts` cannot
 * silently stop covering a capability somebody added. `delete_override` is absent by construction:
 * it is `direct`, and a direct op has no document to echo.
 */
export const replayableCapabilities = (): string[] =>
  Object.entries(capabilityRegistry())
    .filter(([, c]) => c.behaviourMutation.kind === "echo")
    .map(([key]) => key)
    .sort();
