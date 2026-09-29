import { describe, expect, it } from "vitest";
import type { ApplicationCaptureView } from "@silvicom/shared";
import { markOnFile } from "./markOnFile";

const staged = (slot: string) => ({ slot, capturedAt: "2026-09-28T10:00:00Z" }) as unknown as ApplicationCaptureView;

describe("markOnFile — a picture the packet can carry over", () => {
  it("is a staged capture of that kind, as before C3s1", () => {
    expect(markOnFile("signature", [staged("signature_mark")], undefined)).toBe(true);
    expect(markOnFile("initials", [staged("signature_mark")], undefined)).toBe(false);
  });

  it("or screen 13's adoption of that kind (D-AW15)", () => {
    const adoptions = { signature: "Susan Godfrey", initials: null };
    expect(markOnFile("signature", [], adoptions)).toBe(true);
    expect(markOnFile("initials", [], adoptions)).toBe(false);
  });

  it("and nothing else — a photograph is not a mark", () => {
    expect(markOnFile("signature", [staged("cdl_front")], { signature: null, initials: null })).toBe(false);
  });
});
