import { elementOrder } from "./efsCardCanonical.js";
import { EfsSoapError } from "./efsSoapSession.js";
import type { XmlElement } from "./efsXml.js";

/**
 * The order a `WSCardv2` puts its children in, and refusing to send one that does not.
 *
 * Separate from `efsCardCanonical.ts` on purpose: that module states it "knows nothing about cards at
 * all", and a WSDL sequence for WSCardv2 is card knowledge. `elementOrder` lives there because
 * reading a DOM's child order is generic; what that order is SUPPOSED to be lives here.
 *
 * Separate from `efsCardEcho.ts` because that file is at its 500-line budget, and this is a whole
 * guard with its own vocabulary rather than a few more lines of an existing one.
 */

/**
 * The order `WSCardv2` declares its children in (WSDL `<sequence>`).
 *
 * `setCardv2` takes a `WSCardv2`, and a schema sequence is ORDERED: a conforming document puts these
 * elements in exactly this order. Axis2 has already shown this vendor answers a shape it did not
 * expect with a void success and no effect (the operation-name and `<card>`-wrapper incidents, and
 * audit W3), so "it parsed for us" is not evidence a reordered request applies.
 *
 * `header` is the nested shape's wrapper. On the flat shape the header scalars sit at root level as
 * individual elements — which is why `sequenceRank` maps anything unlisted onto the header's slot
 * rather than rejecting it: on that shape the scalars ARE the header, and a field WEX adds next year
 * belongs with them rather than nowhere.
 */
export const WS_CARD_SEQUENCE = [
  "cardNumber",
  "header",
  "infos",
  "limits",
  "locationGroups",
  "locations",
  "timeRestrictions",
] as const;

const SEQUENCE_RANK: ReadonlyMap<string, number> = new Map(WS_CARD_SEQUENCE.map((name, i) => [name, i]));
const HEADER_RANK = SEQUENCE_RANK.get("header") ?? 1;

/** Where a child of the card element belongs in the sequence. Unlisted names rank as header scalars. */
export function sequenceRank(name: string): number {
  return SEQUENCE_RANK.get(name) ?? HEADER_RANK;
}

/**
 * The field order inside each repeated record, from `docs/efs/CardManagementWS.wsdl`.
 *
 * Transcribed from the WSDL rather than from a fixture, and it corrected two things a fixture would
 * not have shown:
 *
 *   • `WSCardv2` declares its `limits` as **`WSCardLimitv2`**, not `WSCardLimit` — six fields, with
 *     `autoRollMap` and `autoRollMax` after `minHours`. The four-field `WSCardLimit` is a different
 *     type used by the v1 card, and copying it would have put the auto-roll fields nowhere.
 *   • `numericMatchValue` sits between `reportValue` and `validationType`. EFS's own responses omit
 *     it, so nothing emits it today (see the append path in efsCardEdits.ts) — but if anything ever
 *     does, this is where it goes, and guessing from a response would have put it at the end.
 */
export const WS_CARD_INFO_SEQUENCE = [
  "infoId",
  "lengthCheck",
  "matchValue",
  "maximum",
  "minimum",
  "reportValue",
  "numericMatchValue",
  "validationType",
  "value",
] as const;

/** `WSCardLimitv2` — the type `WSCardv2.limits` actually declares. */
export const WS_CARD_LIMIT_SEQUENCE = ["hours", "limit", "limitId", "minHours", "autoRollMap", "autoRollMax"] as const;

export const WS_CARD_TIME_RESTRICTION_SEQUENCE = ["beginTime", "day", "endTime"] as const;

const RECORD_SEQUENCES: Readonly<Record<string, readonly string[]>> = {
  infos: WS_CARD_INFO_SEQUENCE,
  limits: WS_CARD_LIMIT_SEQUENCE,
  timeRestrictions: WS_CARD_TIME_RESTRICTION_SEQUENCE,
};

/**
 * A record's field names in the order its type declares them.
 *
 * An UNLISTED field keeps its relative position and goes last, rather than being dropped or refused.
 * The whole design rests on unmodelled vendor fields surviving the round trip (see the head of
 * efsCardXml.ts), so a field WEX adds next year has to come back even though we cannot know where in
 * the sequence it belongs. Last is a guess; dropping it is a deletion, and refusing it would brick
 * every card carrying it. `locationGroups` and `locations` are scalar collections with no fields at
 * all, so they are absent here and the caller's order passes through untouched.
 */
/**
 * ── Why there is no `assertRecordFieldOrder` to match `assertSequenceOrder` ──────────────────────
 *
 * One was written and removed, because three existing tests refused it and they were right.
 *
 * `getCardV2.reportOnly.xml` carries its `<infos>` fields in the vendor's own order — `infoId,
 * validationType, matchValue, reportValue, lengthCheck, minimum, maximum, value` — which is NOT the
 * WSDL sequence. Records echoed straight from the response go through `serializeElement`, untouched,
 * so a zero-edit echo of that card reproduces that order. A guard on record field order therefore
 * refuses a byte-identical echo of a document EFS itself sent us, which bricks the card and protects
 * nothing.
 *
 * The principle the guards follow, stated once: **order what WE construct; pass through what the
 * vendor sent.** `serializeRecord` builds records from plain objects and owes them the declared
 * order. `serializeElement` reproduces the vendor's nodes and owes them nothing but fidelity.
 *
 * Card-level order (`assertSequenceOrder`) is normalised rather than passed through, and the
 * asymmetry is deliberate: placing a NEWLY INTRODUCED collection forces a choice of position there,
 * and no equivalent choice arises inside a record — nothing ever inserts a field into an existing
 * one. Both emit content-identical documents; only card-level element order is ever rewritten.
 */
export function orderRecordFields(collection: string, fields: readonly string[]): string[] {
  const sequence = RECORD_SEQUENCES[collection];
  if (!sequence) return [...fields];
  const rank = (field: string): number => {
    const index = sequence.indexOf(field);
    return index === -1 ? sequence.length : index;
  };
  return fields
    .map((field, index) => ({ field, index, rank: rank(field) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.field);
}


/**
 * Refuse a request whose elements are not in WSCardv2's declared sequence.
 *
 * Compared ABSOLUTELY against `WS_CARD_SEQUENCE`, never relative to the response. Two reasons, and
 * the second is the one that decided it:
 *
 *   • `expectedCanonical` re-inserts a replaced collection at the end of its Map, so a relative
 *     comparison would report a difference on exactly the new-collection case this fix enables.
 *   • A card EFS returns out of sequence would otherwise produce an out-of-sequence request and a
 *     refusal, bricking that card for writes. We accept any order on read and emit the declared one.
 *
 * `cardNumber` is deliberately NOT excluded here, unlike in the canonical diff where it is an input
 * rather than echoed content: the sequence puts it first, and that it IS first is worth checking.
 */
export function assertSequenceOrder(card: XmlElement): void {
  const order = elementOrder(card);
  let previousRank = -1;
  let previousName = "";
  for (const name of order) {
    const rank = sequenceRank(name);
    if (rank < previousRank) {
      throw new EfsSoapError(
        `Refusing to send a setCard request whose elements are out of WSCardv2 sequence: <${name}> `
          + `after <${previousName}>. Expected order: ${WS_CARD_SEQUENCE.join(", ")}.`,
        "echo_unfaithful",
        { order, offending: name, after: previousName },
      );
    }
    previousRank = rank;
    previousName = name;
  }
}
