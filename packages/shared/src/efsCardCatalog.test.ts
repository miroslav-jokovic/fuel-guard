import { describe, expect, it } from "vitest";
import {
  EFS_INFO_LABELS,
  EFS_LIMIT_LABELS,
  EFS_UNEDITABLE_INFO_IDS,
  matchStatusCasing,
  resolveEditableInfoIds,
  resolveLimitVocabulary,
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

/**
 * The vocabulary Step 10.3's picker is fed from.
 *
 * The account fixtures below are the real shapes from `docs/efs/account-inventory-production.json`,
 * read 2026-08-17. The `DSL` case is the one that matters and the reason this resolver exists at
 * all: both handoffs said the limit ids come from `getProducts`, and `DSL` is not in that response
 * on this account — it exists only as a product GROUP. WEX's Overrides guide says a diesel override
 * must name both `DSL` and `ULSD`, so a picker built on the handoff's instruction could not have
 * expressed a working diesel exception.
 */
describe("resolveLimitVocabulary", () => {
  const account = [
    { groupId: "DSL", description: "DIESEL", isFuel: true },
    { groupId: "ULSD", description: "ULTRA LOW SULFUR DIESEL", isFuel: true },
    { groupId: "WASH", description: "CAR WASH", isFuel: false },
    // Real, and in neither the guide's Limit IDs table nor `EFS_LIMIT_LABELS`.
    { groupId: "HYDR", description: "HYDROGEN", isFuel: true },
  ];

  it("offers DSL — the id that is a product GROUP and not a product", () => {
    const ids = resolveLimitVocabulary(account).map((o) => o.limitId);
    expect(ids).toContain("DSL");
    expect(ids).toContain("ULSD");
  });

  it("keeps an account group the guide's table has never heard of", () => {
    // The positive control for the decision NOT to intersect with `EFS_LIMIT_LABELS`. Prompts are
    // intersected because `getPromptTypes` returns bare codes; this response carries its own
    // description, so the "switch with no label" argument does not apply and dropping HYDR would
    // hide a product this account genuinely sells.
    expect(EFS_LIMIT_LABELS.HYDR).toBeUndefined();
    const hydr = resolveLimitVocabulary(account).find((o) => o.limitId === "HYDR");
    expect(hydr).toBeDefined();
    expect(hydr!.label).toBe("HYDROGEN");
  });

  it("prefers the ACCOUNT's wording over our transcription", () => {
    // Our table says "Diesel"; the portal shows the operator "DIESEL". The account wins.
    expect(EFS_LIMIT_LABELS.DSL).toBe("Diesel");
    expect(resolveLimitVocabulary(account).find((o) => o.limitId === "DSL")!.label).toBe("DIESEL");
  });

  it("never asserts gallons on a fuel it cannot name", () => {
    const by = (id: string) => resolveLimitVocabulary(account).find((o) => o.limitId === id)!;
    // Named liquids get the unit the guide's p36 rule gives them...
    expect(by("DSL").unit).toBe("gallons");
    // ...and hydrogen, which this account reports as fuel and which is sold by the kilogram, gets a
    // bare quantity rather than a wrong one. "100 gal" against "$100" is a full tank against a third
    // of one, and an invented unit is the same class of error in the other direction.
    expect(by("HYDR").unit).toBe("units");
    // The account said it is not fuel, so there is nothing to be conservative about.
    expect(by("WASH").unit).toBe("dollars");
  });

  it("falls back to the guide's table for an account nobody has walked", () => {
    const fallback = resolveLimitVocabulary(null);
    expect(fallback.length).toBe(Object.keys(EFS_LIMIT_LABELS).length);
    expect(fallback.map((o) => o.limitId)).toContain("ULSD");
    // Empty takes the same route as null, deliberately: for the operator, an account that offers
    // nothing and an account we never asked are one situation.
    expect(resolveLimitVocabulary([]).length).toBe(fallback.length);
  });

  it("is never empty, so the client never has to decide what an absent list means", () => {
    for (const input of [null, undefined, [], account]) {
      expect(resolveLimitVocabulary(input).length).toBeGreaterThan(0);
    }
  });
});
