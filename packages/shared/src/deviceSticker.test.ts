import { describe, expect, it } from "vitest";
import { isImei, luhnValid, readStickerCode } from "./deviceSticker.js";

// 3GPP TS 23.003's own worked example, and a real Samsung Galaxy Tab Active IMEI shape.
const IMEI = "490154203237518";

describe("isImei", () => {
  it("accepts 15 digits whose last is the Luhn check digit", () => {
    expect(isImei(IMEI)).toBe(true);
    expect(luhnValid(IMEI)).toBe(true);
  });

  it("refuses a wrong check digit, fourteen or sixteen digits, and anything not digits", () => {
    expect(isImei("490154203237519")).toBe(false);
    expect(isImei("49015420323751")).toBe(false);
    expect(isImei("4901542032375180")).toBe(false);
    expect(isImei("49015420323751 8")).toBe(false);
    expect(isImei("")).toBe(false);
  });
});

describe("readStickerCode — one barcode off the back of a tablet", () => {
  it("reads the IMEI barcode, with or without a caption or print spacing", () => {
    expect(readStickerCode(IMEI)).toEqual({ kind: "imei", imei: IMEI });
    expect(readStickerCode(`IMEI: ${IMEI}`)).toEqual({ kind: "imei", imei: IMEI });
    expect(readStickerCode("IMEI1 49 015420 323751 8")).toEqual({ kind: "imei", imei: IMEI });
  });

  it("calls fifteen digits that fail the check a misread IMEI — never a serial", () => {
    expect(readStickerCode("490154203237519")).toEqual({ kind: "bad_imei", digits: "490154203237519" });
    expect(readStickerCode("IMEI 4901542032375")).toEqual({ kind: "bad_imei", digits: "4901542032375" });
  });

  it("tells the SIM card's number and the box's retail barcode apart from the IMEI", () => {
    expect(readStickerCode("8901260882212345678")).toEqual({ kind: "sim", iccid: "8901260882212345678" });
    expect(readStickerCode("89012608822123456789")).toEqual({ kind: "sim", iccid: "89012608822123456789" });
    expect(readStickerCode("8806094937121")).toEqual({ kind: "box_barcode", gtin: "8806094937121" });
    expect(readStickerCode("036000291452")).toEqual({ kind: "box_barcode", gtin: "036000291452" });
  });

  it("reads a model only where the maker's prefix is unambiguous, and names the maker", () => {
    expect(readStickerCode("SM-T575")).toEqual({ kind: "model", model: "SM-T575", manufacturer: "Samsung" });
    expect(readStickerCode("sm-x306b")).toEqual({ kind: "model", model: "SM-X306B", manufacturer: "Samsung" });
    expect(readStickerCode("TB-X606F")).toEqual({ kind: "model", model: "TB-X606F", manufacturer: "Lenovo" });
  });

  it("takes what is left as the serial, upper-cased, with an S/N caption dropped", () => {
    expect(readStickerCode("R52W40ABCDE")).toEqual({ kind: "serial", serial: "R52W40ABCDE" });
    expect(readStickerCode("S/N: r52w40abcde")).toEqual({ kind: "serial", serial: "R52W40ABCDE" });
    // A twelve-digit number whose GS1 check digit is wrong is somebody's serial, not a box barcode.
    expect(readStickerCode("123456789020")).toEqual({ kind: "serial", serial: "123456789020" });
  });

  it("says unknown rather than guessing at something with spaces or punctuation in it", () => {
    expect(readStickerCode("Made in Vietnam")).toEqual({ kind: "unknown", code: "Made in Vietnam" });
    expect(readStickerCode("SIL1:AST:7K3M9P")).toEqual({ kind: "unknown", code: "SIL1:AST:7K3M9P" });
  });
});
