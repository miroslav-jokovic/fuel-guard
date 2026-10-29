import { describe, expect, it } from "vitest";
import { sameModelFrom, tacOf } from "./tacMatch";

/**
 * The maker and model from the shop's own tablets with the same TAC (owner 2026-10-29). The rules that can
 * go wrong without anyone noticing: matching anywhere in the IMEI instead of its first eight digits (the
 * API's search is a substring), copying from the tablet itself, and picking one of two answers that disagree.
 */
const A = (displayNo: string, imei: string | null, manufacturer: string | null, model: string | null) => ({ displayNo, imei, manufacturer, model });
const NEW = "35693803564380 9".replace(" ", "");

describe("the same model, read off the IMEI's TAC", () => {
  it("is the first eight digits", () => expect(tacOf(NEW)).toBe("35693803"));

  it("copies the maker and model of a tablet whose IMEI starts with the same TAC", () => {
    expect(sameModelFrom([A("A-0412", "356938039999990", "Samsung", "SM-T575")], NEW)).toEqual({
      manufacturer: "Samsung", model: "SM-T575", fromDisplayNo: "A-0412",
    });
  });

  it("ignores a tablet that only contains the TAC further along", () => {
    expect(sameModelFrom([A("A-0412", "1356938030000000".slice(0, 15), "Lenovo", "TB-X606F")], NEW)).toBeNull();
  });

  it("never answers from the tablet being entered, or from one with nothing to copy", () => {
    expect(sameModelFrom([A("A-0001", NEW, "Samsung", "SM-T575"), A("A-0002", "356938031111110", null, null)], NEW)).toBeNull();
  });

  it("answers nothing when two tablets with the TAC disagree", () => {
    const two = [A("A-1", "356938031111110", "Samsung", "SM-T575"), A("A-2", "356938032222220", "Samsung", "SM-T577")];
    expect(sameModelFrom(two, NEW)).toBeNull();
  });
});
