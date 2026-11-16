import { describe, expect, it } from "vitest";
import { normaliseTagNumber, tollTagKey, isTollProvider, TOLL_PROVIDERS } from "./tollTags.js";
import { attributeToll, SWAP_MARGIN_MS, type TagAssignment } from "./tollAttribution.js";
import { transponderCreateSchema, transponderMoveSchema } from "./tollContract.js";

describe("toll tag identity", () => {
  it("stores what is printed, without the separators people type", () => {
    expect(normaliseTagNumber("008-1234 5678")).toBe("00812345678");
    expect(normaliseTagNumber(" kt.0000.777 ")).toBe("KT0000777");
  });

  it("refuses a masked or mistyped number instead of dropping the stray characters", () => {
    expect(normaliseTagNumber("****5678")).toBeNull();
    expect(normaliseTagNumber("0081/2345678")).toBeNull();
    expect(normaliseTagNumber("123")).toBeNull();
    expect(normaliseTagNumber("")).toBeNull();
    expect(normaliseTagNumber(null)).toBeNull();
  });

  it("matches a number Excel stripped of its leading zeros to the tag as printed", () => {
    expect(tollTagKey("ezpass", "00812345678")).toBe(tollTagKey("ezpass", 812345678));
    expect(tollTagKey("ezpass", "008-1234-5678")).toBe("ezpass:812345678");
  });

  it("keeps the same digits under two providers as two tags", () => {
    expect(tollTagKey("ezpass", "12345678")).not.toBe(tollTagKey("ktag", "12345678"));
  });

  it("keeps an all-zero number a key rather than an empty one", () => {
    expect(tollTagKey("ktag", "0000")).toBe("ktag:0");
  });

  it("knows exactly the three providers 0622 allows, and PrePass is not one", () => {
    expect([...TOLL_PROVIDERS]).toEqual(["ezpass", "ktag", "expresstoll"]);
    expect(isTollProvider("prepass")).toBe(false);
    expect(isTollProvider("ktag")).toBe(true);
  });
});

const H = 60 * 60 * 1000;
const t = (iso: string) => Date.parse(iso);
const row = (vehicleId: string, validFrom: string, validTo: string | null, voided = false): TagAssignment => ({
  vehicleId,
  validFrom,
  validTo,
  voided,
});

describe("attributeToll", () => {
  // Tag on truck A from June 1, moved to truck B on June 10 at 14:00Z, taken off June 20.
  const history = [row("A", "2026-06-01T00:00:00Z", "2026-06-10T14:00:00Z"), row("B", "2026-06-10T14:00:00Z", "2026-06-20T00:00:00Z")];

  it("charges a toll to the truck that held the tag when it was driven", () => {
    expect(attributeToll(history, t("2026-06-05T12:00:00Z"))).toEqual({ kind: "matched", vehicleId: "A" });
    expect(attributeToll(history, t("2026-06-15T12:00:00Z"))).toEqual({ kind: "matched", vehicleId: "B" });
  });

  it("does not guess between two trucks within the margin of a swap, on either side", () => {
    const swap = t("2026-06-10T14:00:00Z");
    expect(attributeToll(history, swap - 2 * H)).toEqual({ kind: "near_swap", vehicleIds: ["A", "B"] });
    expect(attributeToll(history, swap + 2 * H)).toEqual({ kind: "near_swap", vehicleIds: ["B", "A"] });
  });

  it("matches again just outside the margin", () => {
    const swap = t("2026-06-10T14:00:00Z");
    expect(attributeToll(history, swap - SWAP_MARGIN_MS - 1)).toEqual({ kind: "matched", vehicleId: "A" });
    expect(attributeToll(history, swap + SWAP_MARGIN_MS + 1)).toEqual({ kind: "matched", vehicleId: "B" });
  });

  it("sends a toll stamped just after the tag came off a truck to review, naming that truck", () => {
    expect(attributeToll(history, t("2026-06-20T01:00:00Z"))).toEqual({ kind: "near_swap", vehicleIds: ["B"] });
  });

  it("reports a toll on a tag no truck held as unassigned, never spread", () => {
    expect(attributeToll(history, t("2026-07-01T00:00:00Z"))).toEqual({ kind: "unassigned" });
    expect(attributeToll([], t("2026-07-01T00:00:00Z"))).toEqual({ kind: "unassigned" });
  });

  it("ignores a voided assignment, so a correction re-attributes by itself", () => {
    const corrected = [row("A", "2026-06-01T00:00:00Z", "2026-06-10T14:00:00Z", true), row("C", "2026-06-01T00:00:00Z", "2026-06-10T14:00:00Z")];
    expect(attributeToll(corrected, t("2026-06-05T12:00:00Z"))).toEqual({ kind: "matched", vehicleId: "C" });
  });

  it("treats an open row as running forever", () => {
    expect(attributeToll([row("A", "2026-06-01T00:00:00Z", null)], t("2027-01-01T00:00:00Z"))).toEqual({ kind: "matched", vehicleId: "A" });
  });

  it("names both trucks rather than picking one if a history ever overlapped", () => {
    const broken = [row("A", "2026-06-01T00:00:00Z", null), row("B", "2026-06-03T00:00:00Z", null)];
    expect(attributeToll(broken, t("2026-06-05T00:00:00Z"))).toEqual({ kind: "near_swap", vehicleIds: ["A", "B"] });
  });

  it("is not fooled by a boundary between two rows of the same truck", () => {
    const split = [row("A", "2026-06-01T00:00:00Z", "2026-06-10T00:00:00Z"), row("A", "2026-06-10T00:00:00Z", null)];
    expect(attributeToll(split, t("2026-06-10T01:00:00Z"))).toEqual({ kind: "matched", vehicleId: "A" });
  });
});

describe("transponder contract", () => {
  it("normalises the typed number and refuses PrePass", () => {
    const ok = transponderCreateSchema.parse({ provider: "ezpass", tagNumber: "008-1234 5678" });
    expect(ok.tagNumber).toBe("00812345678");
    expect(transponderCreateSchema.safeParse({ provider: "prepass", tagNumber: "12345678" }).success).toBe(false);
    expect(transponderCreateSchema.safeParse({ provider: "ktag", tagNumber: "****1234" }).success).toBe(false);
  });

  it("takes a move to no truck as taking the tag off", () => {
    const m = transponderMoveSchema.parse({ vehicleId: null, at: "2026-06-10T14:00:00.000Z" });
    expect(m.vehicleId).toBeNull();
    expect(transponderMoveSchema.safeParse({ vehicleId: null, at: "June 10" }).success).toBe(false);
  });
});
