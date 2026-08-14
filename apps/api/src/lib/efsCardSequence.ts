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
