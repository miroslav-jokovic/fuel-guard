import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EFS_DYNAMIC_INFO_IDS,
  EFS_EDITABLE_INFO_IDS,
  EFS_INFO_LABELS,
  resolveEditableInfoIds,
} from "@silvicom/shared";

/**
 * Step 9.1, applied to the REAL accounts.
 *
 * `resolveEditableInfoIds`' own edges live in `packages/shared/src/efsCardCatalog.test.ts`. This file
 * asserts the only thing that suite cannot: what the rule produces when fed what WEX actually said.
 * It reads the inventories Miki captured live on 2026-08-16 and committed under `docs/efs/` — the
 * same artefacts `efsAccountOps.test.ts` and `efsCardFields.test.ts` read the WSDL from.
 *
 * ── Why the captures and not a hand-written array of 24 ──────────────────────────────────────────
 * The claim being defended is "24 prompts, the same 24 on both orgs". A hand-written array would
 * pass whether or not that is still true of the accounts, which is the property that makes it
 * worthless. Edit `EFS_INFO_LABELS`, add a denial, or replace a capture, and these move.
 *
 * ── Why it lives in apps/api ─────────────────────────────────────────────────────────────────────
 * Not because the resolver does — it is shared, and the browser needs it too. `packages/shared`
 * builds for React Native and carries no Node typings, so `readFileSync` does not typecheck there.
 */
const capture = (org: "production" | "qa"): { promptTypes: string[] } => {
  const path = fileURLToPath(new URL(`../../../../../docs/efs/account-inventory-${org}.json`, import.meta.url));
  return { promptTypes: JSON.parse(readFileSync(path, "utf8")).inventory.promptTypes };
};

describe("the editable prompt set, against the accounts it will be used on", () => {
  const PRODUCTION = capture("production").promptTypes;
  const QA = capture("qa").promptTypes;

  it("reads the captures this suite is arguing about — 40 on production, 41 on QA", () => {
    // A positive control on the FIXTURES. Without it a truncated, renamed or reshaped capture would
    // hand every assertion below an empty array, and every one of them would pass via the fallback.
    expect(PRODUCTION).toHaveLength(40);
    expect(QA).toHaveLength(41);
    expect(QA).toContain("VEHN"); // the one ID QA has and production does not
    expect(PRODUCTION).not.toContain("VEHN");
  });

  it("resolves both accounts to the SAME 24, in the same order", () => {
    const production = resolveEditableInfoIds(PRODUCTION);
    expect(production).toHaveLength(24);
    expect(resolveEditableInfoIds(QA)).toEqual(production);
  });

  it("offers nothing the vendor's own Info IDs table defines no meaning for", () => {
    // 15 codes on production and 16 on QA are absent from the guide's table (p168-169): DSCD, DMLC,
    // LSNB, CUNB, VHTP, PDLN, CLCD, VHNB, CVNM, LCCD, PLDS, SPLN, SLDS, CVNB, CARR, and QA's VEHN.
    // A NON-EMPTY string, not merely truthy: a label of "" would render as a blank option in the
    // prompt editor, which is the same defect as an undocumented id wearing a different disguise.
    for (const id of resolveEditableInfoIds(PRODUCTION)) {
      expect(EFS_INFO_LABELS[id]).toEqual(expect.any(String));
      expect((EFS_INFO_LABELS[id] ?? "").length).toBeGreaterThan(0);
    }
    expect(PRODUCTION).toContain("CARR"); // the account really does offer it…
    expect(resolveEditableInfoIds(PRODUCTION)).not.toContain("CARR"); // …and we really do not.
  });

  it("denies PPIN, which both accounts offer", () => {
    expect(PRODUCTION).toContain("PPIN");
    expect(QA).toContain("PPIN");
    expect(resolveEditableInfoIds(PRODUCTION)).not.toContain("PPIN");
    expect(resolveEditableInfoIds(QA)).not.toContain("PPIN");
  });

  it("keeps everything that was reachable BEFORE Phase 9, and adds ODRD", () => {
    // Widening must not silently drop what the hardcoded pair already reached — that is a regression
    // wearing a feature's clothes. ODRD is the one Step 9.3 needs for odometer following.
    for (const id of [...EFS_EDITABLE_INFO_IDS, "ODRD"]) {
      expect(resolveEditableInfoIds(PRODUCTION)).toContain(id);
    }
  });

  it("leaves DYNAMIC reachable on CNTN and DRID only, PPIN being denied", () => {
    // Not a mistranscription of the vendor's rule (p36: CNTN, PPIN and DRID) but a narrowing of it,
    // and one that follows from the denial rather than from a second, unrecorded decision.
    const resolved = resolveEditableInfoIds(PRODUCTION);
    expect(EFS_DYNAMIC_INFO_IDS.filter((id) => resolved.includes(id))).toEqual(["CNTN", "DRID"]);
  });

  it("covers every prompt id either account has a CARD-level record for", () => {
    // `docs/25` Q2: production uses 8 card-level info ids across 162 cards, QA 3 across 7. If the
    // resolved set missed one, this product could read a prompt it cannot edit — the exact gap
    // Phase 9 exists to close, and one no synthetic input would have revealed.
    const inUse = ["DRID", "NAME", "TRIP", "TRLR", "UNIT", "CNTN", "DLIC", "DLST"];
    expect(resolveEditableInfoIds(PRODUCTION)).toEqual(expect.arrayContaining(inUse));
  });
});
