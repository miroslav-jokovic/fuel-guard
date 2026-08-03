import { describe, it, expect } from "vitest";
import {
  cardIdentityKey,
  cardIsIdentifiable,
  cardDigits,
  cardLast4,
  cardRefsMatch,
  cardRefsDefinitelyMatch,
  isFullCardNumber,
  isMaskedCardRef,
  learnCardAssignments,
  assessCardAssignment,
  sameCardFill,
  dominantVehicle,
  type CardFillRow,
} from "./cardAssignment.js";

describe("mask detection (WP3c — EFS stopped sending full card numbers)", () => {
  it("recognises every masked shape EFS emits and keeps only the card's own digits", () => {
    expect(isMaskedCardRef("708305XXXXXX1234")).toBe(true);
    expect(isMaskedCardRef("****1234")).toBe(true);
    expect(isMaskedCardRef("••••1234")).toBe(true);
    expect(isMaskedCardRef("7083050030485867142")).toBe(false);
    expect(cardDigits("708305XXXXXX1234")).toBe("1234");
    expect(cardDigits("****1234")).toBe("1234");
    expect(cardDigits("7083050030485867142  ")).toBe("7083050030485867142");
  });
  it("a masked ref is NEVER a full card number, however many digits survive the mask", () => {
    // `708305XXXXXX1234` → 10 digits under a naive digits-only view. That is what the pre-WP3c
    // ≥8-digit test misread as a PAN, silencing the control id and conflating every card that
    // shares this BIN + last-4.
    expect(isFullCardNumber("708305XXXXXX1234")).toBe(false);
    expect(isFullCardNumber("7083050030485867142")).toBe(true);
    expect(isFullCardNumber("1234")).toBe(false);
  });
  it("leaves genuinely alphanumeric fleet refs alone ('x' only masks in an otherwise-numeric ref)", () => {
    expect(isMaskedCardRef("TX1234")).toBe(false);
    expect(cardDigits("TX1234")).toBe("1234");
  });
});

describe("cardIdentityKey / cardLast4 / cardRefsMatch", () => {
  it("full PAN (EFS pads with spaces) → digits key", () => {
    expect(cardIdentityKey("7083050030485867142      ")).toBe("7083050030485867142");
    expect(cardLast4("7083050030485867142      ")).toBe("7142");
  });
  it("masked last-4 needs a control id to identify a card; bare last-4 never guesses", () => {
    expect(cardIdentityKey("7521", "WCHRISTO")).toBe("7521|WCHRISTO");
    expect(cardIdentityKey("7521", null)).toBeNull();
    expect(cardIdentityKey(null)).toBeNull();
    expect(cardIsIdentifiable("7521", null)).toBe(false);
    expect(cardIsIdentifiable("7521", "WCHRISTO")).toBe(true);
  });
  it("every masked shape of ONE card + control id collapses to ONE identity key", () => {
    expect(cardIdentityKey("708305XXXXXX1234", "WCHRISTO")).toBe("1234|WCHRISTO");
    expect(cardIdentityKey("****1234", "WCHRISTO")).toBe("1234|WCHRISTO");
    expect(cardIdentityKey("1234", "WCHRISTO")).toBe("1234|WCHRISTO");
  });
  it("a masked ref never yields a PAN-shaped key (the 0075 conflation)", () => {
    expect(cardIdentityKey("708305XXXXXX1234", "AAA")).not.toBe(cardIdentityKey("708305XXXXXX1234", "BBB"));
    expect(cardIdentityKey("708305XXXXXX1234", null)).toBeNull();
  });
  it("cardRefsDefinitelyMatch only trusts two unmasked full numbers", () => {
    expect(cardRefsDefinitelyMatch("7083050030281917521", "7083050030281917521 ")).toBe(true);
    expect(cardRefsDefinitelyMatch("7083050030281917521", "7521")).toBe(false);
    expect(cardRefsDefinitelyMatch("7521", "7521")).toBe(false);
  });
  it("cardRefsMatch handles full-vs-masked (F5): full PAN matches its own last-4", () => {
    expect(cardRefsMatch("7083050030281917521", "7521")).toBe(true);
    expect(cardRefsMatch("7521", "7083050030281917521")).toBe(true);
    expect(cardRefsMatch("7083050030281917521", "7083050030281917521 ")).toBe(true);
    expect(cardRefsMatch("7083050030281917521", "9999")).toBe(false);
    expect(cardRefsMatch("752", "7083050030281917521")).toBe(false); // <4 digits never matches
    expect(cardRefsMatch(null, "7521")).toBe(false);
  });
});

const fills = (vehicleId: string, n: number, card = "7083050030281917521"): CardFillRow[] =>
  Array.from({ length: n }, () => ({ cardRef: card, controlId: null, vehicleId }));

describe("learnCardAssignments", () => {
  it("assigns with ≥5 fills and a ≥70% majority on one vehicle", () => {
    const learned = learnCardAssignments([...fills("vehA", 6), ...fills("vehB", 1)]);
    expect(learned).toHaveLength(1);
    expect(learned[0]!.vehicleId).toBe("vehA");
    expect(learned[0]!.cardLast4).toBe("7521");
    expect(learned[0]!.share).toBeCloseTo(0.86, 2);
  });
  it("hysteresis: 4 fills is not enough evidence", () => {
    expect(learnCardAssignments(fills("vehA", 4))).toHaveLength(0);
  });
  it("a floating/slip-seat card (60/40 split) yields NO assignment — never guess", () => {
    expect(learnCardAssignments([...fills("vehA", 6), ...fills("vehB", 4)])).toHaveLength(0);
  });
  it("unattributed fills and unidentifiable cards are ignored", () => {
    const rows: CardFillRow[] = [
      ...fills("vehA", 5),
      { cardRef: "7083050030281917521", controlId: null, vehicleId: null }, // unattributed → ignored
      { cardRef: "7521", controlId: null, vehicleId: "vehB" }, // bare last-4, no control → no identity
    ];
    const learned = learnCardAssignments(rows);
    expect(learned).toHaveLength(1);
    expect(learned[0]!.vehicleId).toBe("vehA");
  });
  it("masked cards with control ids are separate identities (same last-4, different drivers)", () => {
    const a: CardFillRow[] = Array.from({ length: 5 }, () => ({ cardRef: "7521", controlId: "AAA", vehicleId: "vehA" }));
    const b: CardFillRow[] = Array.from({ length: 5 }, () => ({ cardRef: "7521", controlId: "BBB", vehicleId: "vehB" }));
    const learned = learnCardAssignments([...a, ...b]).sort((x, y) => x.cardKey.localeCompare(y.cardKey));
    expect(learned).toHaveLength(2);
    expect(learned[0]!.vehicleId).toBe("vehA");
    expect(learned[1]!.vehicleId).toBe("vehB");
  });
});

describe("assessCardAssignment — stale vs typo vs confirmed misuse (audit decision tree)", () => {
  const base = { assignedVehicleId: "A", pumpVehicleId: "B" };
  it("no assignment / same vehicle → none", () => {
    expect(assessCardAssignment({ assignedVehicleId: null, pumpVehicleId: "B", pumpUnitAtStation: false, assignedAtStation: false }).kind).toBe("none");
    expect(assessCardAssignment({ assignedVehicleId: "A", pumpVehicleId: "A", pumpUnitAtStation: true, assignedAtStation: null }).kind).toBe("none");
    expect(assessCardAssignment({ assignedVehicleId: "A", pumpVehicleId: null, pumpUnitAtStation: null, assignedAtStation: false }).kind).toBe("none");
  });
  it("pump-unit truck at the station → stale assignment (fix the record, not fraud)", () => {
    expect(assessCardAssignment({ ...base, pumpUnitAtStation: true, assignedAtStation: false }).kind).toBe("stale_assignment");
  });
  it("assigned truck at the station → mis-keyed pump unit (card is with its truck)", () => {
    expect(assessCardAssignment({ ...base, pumpUnitAtStation: false, assignedAtStation: true }).kind).toBe("unit_typo");
  });
  it("NEITHER truck at the station (positive evidence both) → confirmed mismatch", () => {
    expect(assessCardAssignment({ ...base, pumpUnitAtStation: false, assignedAtStation: false }).kind).toBe("mismatch_confirmed");
  });
  it("unknown telematics → unverified (corroboration-only), never confirmed", () => {
    expect(assessCardAssignment({ ...base, pumpUnitAtStation: null, assignedAtStation: null }).kind).toBe("mismatch_unverified");
    expect(assessCardAssignment({ ...base, pumpUnitAtStation: false, assignedAtStation: null }).kind).toBe("mismatch_unverified");
    expect(assessCardAssignment({ ...base, pumpUnitAtStation: null, assignedAtStation: false }).kind).toBe("mismatch_unverified");
  });
});

describe("sameCardFill (WP3 — the card_multi_vehicle identity test)", () => {
  it("a full PAN vs a bare last-4 is NOT proof of one card — a suffix is shared by every card ending in it", () => {
    // Pre-WP3c this returned true, so one masked fill collected every full-PAN fill ending in 7521
    // (i.e. other drivers' trucks) and fired card_multi_vehicle at high severity.
    expect(sameCardFill({ cardRef: "7083050030281917521", controlId: null }, { cardRef: "7521", controlId: "WCHRISTO" })).toBe(false);
  });
  it("cross-era (PAN history vs masked present) resolves when BOTH carry the same control id", () => {
    expect(sameCardFill({ cardRef: "7083050030281917521", controlId: "WCHRISTO" }, { cardRef: "708305XXXXXX7521", controlId: "WCHRISTO" })).toBe(true);
    expect(sameCardFill({ cardRef: "7083050030281917521", controlId: "WCHRISTO" }, { cardRef: "708305XXXXXX7521", controlId: "OTHERDRV" })).toBe(false);
  });
  it("two unmasked PANs are decided by their digits alone", () => {
    expect(sameCardFill({ cardRef: "7083050030281917521", controlId: null }, { cardRef: "7083050030281917521 ", controlId: null })).toBe(true);
    expect(sameCardFill({ cardRef: "7083050030281917521", controlId: "AAA" }, { cardRef: "7083050030999917521", controlId: "AAA" })).toBe(false);
  });
  it("BIN-prefixed masks sharing a last-4 are two cards unless the control ids agree", () => {
    expect(sameCardFill({ cardRef: "708305XXXXXX1234", controlId: "AAA" }, { cardRef: "708305XXXXXX1234", controlId: "BBB" })).toBe(false);
    expect(sameCardFill({ cardRef: "708305XXXXXX1234", controlId: "AAA" }, { cardRef: "708305XXXXXX1234", controlId: null })).toBe(false);
    expect(sameCardFill({ cardRef: "708305XXXXXX1234", controlId: "AAA" }, { cardRef: "****1234", controlId: "AAA" })).toBe(true);
  });
  it("is symmetric", () => {
    const a = { cardRef: "7083050030281917521", controlId: null };
    const b = { cardRef: "7521", controlId: "WCHRISTO" };
    expect(sameCardFill(a, b)).toBe(sameCardFill(b, a));
  });
  it("same last-4 with DIFFERENT control ids = two drivers' cards — never the same card (0075)", () => {
    expect(sameCardFill({ cardRef: "7521", controlId: "AAA" }, { cardRef: "7521", controlId: "BBB" })).toBe(false);
  });
  it("same last-4 with matching control ids = same card", () => {
    expect(sameCardFill({ cardRef: "7521", controlId: "AAA" }, { cardRef: "7521", controlId: "AAA" })).toBe(true);
  });
  it("non-matching digits never match; missing refs never match", () => {
    expect(sameCardFill({ cardRef: "1111", controlId: null }, { cardRef: "2222", controlId: null })).toBe(false);
    expect(sameCardFill({ cardRef: null, controlId: "AAA" }, { cardRef: "7521", controlId: "AAA" })).toBe(false);
  });
  it("same last-4 with a MISSING control id cannot confirm same-card (no false conflation → no false 48h alert)", () => {
    expect(sameCardFill({ cardRef: "7521", controlId: null }, { cardRef: "7521", controlId: "AAA" })).toBe(false);
    expect(sameCardFill({ cardRef: "7521", controlId: "AAA" }, { cardRef: "7521", controlId: null })).toBe(false);
    expect(sameCardFill({ cardRef: "7521", controlId: null }, { cardRef: "7521", controlId: null })).toBe(false);
  });
});

describe("dominantVehicle (WP3b — as-of-fill-time assignment)", () => {
  it("needs ≥5 attributed fills and a ≥70% majority", () => {
    expect(dominantVehicle(["A", "A", "A", "A"])).toBeNull(); // 4 fills — not enough
    expect(dominantVehicle(["A", "A", "A", "A", "A"])).toBe("A");
    expect(dominantVehicle(["A", "A", "A", "B", "B"])).toBeNull(); // 60% — floating
    expect(dominantVehicle(["A", "A", "A", "A", "B"])).toBe("A"); // 80%
  });
  it("unattributed fills don't count as evidence", () => {
    expect(dominantVehicle([null, null, "A", "A", "A", "A", "A"])).toBe("A");
    expect(dominantVehicle([null, null, null, "A", "A"])).toBeNull();
  });
});
