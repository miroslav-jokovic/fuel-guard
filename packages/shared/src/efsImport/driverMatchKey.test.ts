import { describe, it, expect } from "vitest";
import { driverMatchKey } from "./reconcile.js";

describe("driverMatchKey", () => {
  it("is order-independent and case/punctuation-insensitive (LAST, FIRST vs First Last)", () => {
    expect(driverMatchKey("SMITH, JOHN")).toBe(driverMatchKey("John Smith"));
    expect(driverMatchKey("john  smith")).toBe("john smith");
  });

  it("drops single-char middle initials", () => {
    expect(driverMatchKey("John Q Smith")).toBe("john smith");
  });

  it("strips owner/role annotations so an EFS card name matches the clean Samsara name", () => {
    // Real cases from the fleet: "ANGEL CORA COMP", "WALTER GREEN SR".
    expect(driverMatchKey("ANGEL CORA COMP")).toBe(driverMatchKey("Angel Cora"));
    expect(driverMatchKey("WALTER GREEN SR")).toBe(driverMatchKey("Walter Green"));
    expect(driverMatchKey("John Smith OW")).toBe(driverMatchKey("John Smith"));
    expect(driverMatchKey("Jane Doe JR")).toBe(driverMatchKey("Jane Doe"));
  });

  it("a name that reduces to a single token stays single (won't falsely match a full name)", () => {
    // "ESTEBAN OW" → "esteban" must NOT equal a two-token Samsara key, so it isn't auto-matched.
    expect(driverMatchKey("ESTEBAN OW")).toBe("esteban");
    expect(driverMatchKey("ESTEBAN OW")).not.toBe(driverMatchKey("Esteban Rodriguez"));
  });

  it("does not strip annotation-like fragments that are part of a longer token", () => {
    // 'co' is stripped as a token, but 'cohen'/'cook' (contain 'co') must survive.
    expect(driverMatchKey("Sarah Cohen")).toBe("cohen sarah");
    expect(driverMatchKey("Tim Cook")).toBe("cook tim");
  });

  it("empty / null → empty key", () => {
    expect(driverMatchKey(null)).toBe("");
    expect(driverMatchKey("")).toBe("");
    expect(driverMatchKey("   ")).toBe("");
  });
});
