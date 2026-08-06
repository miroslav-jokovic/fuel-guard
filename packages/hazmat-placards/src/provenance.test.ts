/// <reference types="node" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PLACARD_ART } from "./registry.js";
import {
  PLACARD_ART_ATTESTED,
  PLACARD_ART_PROVENANCE,
  PLACARD_ART_SOURCE,
  PLACARD_GEOMETRY_SPEC,
  PLACARD_PANTONE,
} from "./provenance.js";

describe("@hazmat/placards provenance (M10 §11.7)", () => {
  it("has provenance for all 25 placards, sourced to DOT Chart 17 with the CFR color citation", () => {
    expect(Object.keys(PLACARD_ART_PROVENANCE).length).toBe(25);
    for (const p of Object.values(PLACARD_ART_PROVENANCE)) {
      expect(p.source).toBe("DOT Chart 17");
      expect(p.sourceEdition).toBe(PLACARD_ART_SOURCE.edition);
      expect(p.colorCitation).toBe("49 CFR 172.407(d)(5)");
      expect(p.designRef).toMatch(/^49 CFR 172\.\d/);
    }
  });

  it("records the eCFR-verified geometry + PANTONE specs", () => {
    expect(PLACARD_GEOMETRY_SPEC).toMatchObject({ minSideMm: 250, innerBorderInsetMm: 12.5, minClassNumberHeightMm: 41 });
    expect(PLACARD_PANTONE.colors.red.pantone).toBe("PANTONE 186 U");
    expect(PLACARD_PANTONE.colors.green.pantone).toBe("PANTONE 335 U");
  });

  it("pins every SVG by SHA-256 (visual regression — any art change fails here)", () => {
    for (const [name, art] of Object.entries(PLACARD_ART)) {
      const sha = createHash("sha256").update(art.svg).digest("hex");
      const pinned = PLACARD_ART_PROVENANCE[name as keyof typeof PLACARD_ART_PROVENANCE].svgSha256;
      expect(sha, `SVG for ${name} changed — re-trace/attest and update its provenance SHA`).toBe(pinned);
    }
  });

  it("maps each placard's regulated colors to their §172.407(d)(5) PANTONE codes", () => {
    expect(PLACARD_ART_PROVENANCE.FLAMMABLE.pantone).toContain("PANTONE 186 U"); // red
    expect(PLACARD_ART_PROVENANCE.NON_FLAMMABLE_GAS.pantone).toContain("PANTONE 335 U"); // green
    expect(PLACARD_ART_PROVENANCE.EXPLOSIVES_1_1.pantone).toContain("PANTONE 151 U"); // orange
    expect(PLACARD_ART_PROVENANCE.DANGEROUS_WHEN_WET.pantone).toContain("PANTONE 285 U"); // blue
  });

  it("stays UNATTESTED until every pictogram is traced + SME-signed (§11.2 launch blocker)", () => {
    expect(PLACARD_ART_ATTESTED).toBe(false);
    for (const p of Object.values(PLACARD_ART_PROVENANCE)) {
      expect(p.reviewer).toBeNull();
      expect(p.attestedAt).toBeNull();
    }
  });

  it("provenance symbolProvisional matches the registry (single source of truth)", () => {
    for (const [name, art] of Object.entries(PLACARD_ART)) {
      expect(PLACARD_ART_PROVENANCE[name as keyof typeof PLACARD_ART_PROVENANCE].symbolProvisional).toBe(art.symbolProvisional);
    }
  });
});
