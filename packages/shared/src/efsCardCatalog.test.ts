import { describe, expect, it } from "vitest";
import {
  EFS_INFO_LABELS,
  EFS_UNEDITABLE_INFO_IDS,
  matchStatusCasing,
  resolveEditableInfoIds,
} from "./efsCardCatalog.js";

/**
 * H1 (confirmed 2026-08-12, QA card ••••7671): EFS applies a status write ONLY when its casing
 * matches the account's stored vocabulary — `HOLD` landed in 533ms on an upper-case account,
 * `Active` was answered with the same void success and silently ignored. This helper is the fix;
 * these are its edges. The recipe-level and wire-level proofs live in efsCardEdits.test.ts and
 * efsCardControl.test.ts — this file pins the transform itself.
 */
describe("matchStatusCasing", () => {
  it("imitates an upper-case account", () => {
    expect(matchStatusCasing("ACTIVE", "Hold")).toBe("HOLD");
    expect(matchStatusCasing("HOLD", "Active")).toBe("ACTIVE");
    expect(matchStatusCasing("HOLD", "Inactive")).toBe("INACTIVE");
  });

  it("imitates a lower-case account", () => {
    expect(matchStatusCasing("active", "Hold")).toBe("hold");
    expect(matchStatusCasing("hold", "Active")).toBe("active");
  });

  it("passes the target through verbatim for a mixed-case account — the guide's own spelling", () => {
    expect(matchStatusCasing("Active", "Hold")).toBe("Hold");
    expect(matchStatusCasing("Hold", "Active")).toBe("Active");
  });

  it("passes the target through verbatim when there is nothing to imitate", () => {
    expect(matchStatusCasing(null, "Hold")).toBe("Hold");
    expect(matchStatusCasing(undefined, "Active")).toBe("Active");
    expect(matchStatusCasing("", "Hold")).toBe("Hold");
    expect(matchStatusCasing("   ", "Hold")).toBe("Hold");
    // A letterless observation (digits, punctuation) is upper- AND lower-case at once; neither
    // transform is evidence, so neither is applied.
    expect(matchStatusCasing("123", "Hold")).toBe("Hold");
  });

  it("trims before judging — vendor padding must not disable the imitation", () => {
    expect(matchStatusCasing(" ACTIVE ", "Hold")).toBe("HOLD");
  });
});

/**
 * Step 9.1, the TRANSFORM. What it does to the real accounts is pinned against the committed
 * captures in `apps/api/src/efs/editableInfoIds.test.ts` — `packages/shared` builds for React Native
 * and has no Node typings, so it cannot read `docs/efs/`. Two suites, one for the rule and one for
 * the accounts it is applied to, and neither can go green on its own if the other's claim breaks.
 */
describe("resolveEditableInfoIds", () => {
  it("keeps only what the guide's Info IDs table defines", () => {
    // The accounts return codes the vendor documents nowhere — CARR, VHTP, DSCD and a dozen more.
    // A prompt with no documented meaning is a switch with no label.
    expect(EFS_INFO_LABELS.CARR).toBeUndefined();
    expect(resolveEditableInfoIds(["DRID", "CARR", "VHTP"])).toEqual(["DRID"]);
  });

  it("denies PPIN even when the account offers it", () => {
    expect(EFS_INFO_LABELS.PPIN).toBe("Personal identifier"); // the guide DOES define it (p169)…
    expect(EFS_UNEDITABLE_INFO_IDS).toContain("PPIN"); // …so this exclusion is ours, not the vendor's
    expect(resolveEditableInfoIds(["ODRD", "PPIN"])).toEqual(["ODRD"]);
  });

  it("falls back to DRID/UNIT when getPromptTypes is unavailable", () => {
    // The step's own Verify. Null and empty are the two shapes "never read" arrives in.
    expect(resolveEditableInfoIds(null)).toEqual(["DRID", "UNIT"]);
    expect(resolveEditableInfoIds(undefined)).toEqual(["DRID", "UNIT"]);
    expect(resolveEditableInfoIds([])).toEqual(["DRID", "UNIT"]);
  });

  it("falls back when the account offers only things we cannot name", () => {
    // An empty editor and a never-read account are the same experience for the operator, and the
    // honest answer to both is the fallback.
    expect(resolveEditableInfoIds(["DSCD", "VHTP", "CARR"])).toEqual(["DRID", "UNIT"]);
    // …including when the only overlap is the denied one.
    expect(resolveEditableInfoIds(["PPIN"])).toEqual(["DRID", "UNIT"]);
  });

  it("matches the account's casing and padding, and emits the guide's", () => {
    // This account has already sent a status in an undocumented casing (docs/25 §3).
    //
    // ⚠ The IDs here must NOT be the fallback pair. Asserting `["drid"," Unit "] -> ["DRID","UNIT"]`
    // passes without any case-folding at all: nothing matches, the resolver falls back, and the
    // fallback IS `["DRID","UNIT"]`. That version survived the mutation that deletes `.toUpperCase()`.
    // ODRD and TRIP are reachable only through the fold, so the assertion can only pass one way.
    expect(resolveEditableInfoIds(["odrd", " Trip "])).toEqual(["ODRD", "TRIP"]);
  });

  it("does not repeat an ID the account lists twice, in whatever casing", () => {
    // Same trap, same escape: ODRD rather than DRID, so a survivor cannot hide in the fallback.
    expect(resolveEditableInfoIds(["ODRD", "ODRD", "odrd"])).toEqual(["ODRD"]);
  });

  it("orders by the catalog, not by the response — a vendor reordering cannot reorder a dialog", () => {
    expect(resolveEditableInfoIds(["UNIT", "DRID"])).toEqual(["DRID", "UNIT"]);
    expect(resolveEditableInfoIds(["DRID", "UNIT"])).toEqual(["DRID", "UNIT"]);
  });

  it("leaves DYNAMIC reachable on CNTN and DRID only, PPIN being denied", () => {
    // Not a mistranscription of the vendor's rule (p36: CNTN, PPIN, DRID) — a narrowing of it, and
    // one that follows from the denial rather than from a second decision. Asserted here against the
    // three ids the rule names, and against the real accounts in `apps/api/src/efs/editableInfoIds`.
    expect(resolveEditableInfoIds(["CNTN", "PPIN", "DRID"])).toEqual(["CNTN", "DRID"]);
  });
});
