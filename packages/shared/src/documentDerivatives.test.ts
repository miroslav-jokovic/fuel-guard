import { describe, expect, it } from "vitest";
import {
  DERIVABLE_CONTENT_TYPES,
  DERIVATIVE_CONTENT_TYPE,
  DERIVATIVE_SPECS,
  DERIVATIVE_VERSION,
  derivativeFingerprint,
  derivativeStoragePath,
  derivativesFor,
  shouldDerive,
} from "./documentDerivatives.js";
import { DOCUMENT_CONTENT_TYPES, DOCUMENT_VARIANTS } from "./complianceContract.js";

describe("derivative specs", () => {
  it("produces exactly the two variants the 0146 column already allows", () => {
    expect(DERIVATIVE_SPECS.map((s) => s.variant)).toEqual(["thumb", "normalized"]);
    for (const spec of DERIVATIVE_SPECS) {
      expect(DOCUMENT_VARIANTS).toContain(spec.variant);
    }
  });

  it("never claims the 'original' variant — a derivative cannot masquerade as the record", () => {
    expect(DERIVATIVE_SPECS.some((s) => (s.variant as string) === "original")).toBe(false);
  });

  it("orders thumb smaller and cheaper than normalized", () => {
    const thumb = DERIVATIVE_SPECS.find((s) => s.variant === "thumb")!;
    const normalized = DERIVATIVE_SPECS.find((s) => s.variant === "normalized")!;
    expect(thumb.longEdgePx).toBeLessThan(normalized.longEdgePx);
    expect(thumb.quality).toBeLessThan(normalized.quality);
  });

  it("keeps normalized legible — the medical-card floor is q75", () => {
    const normalized = DERIVATIVE_SPECS.find((s) => s.variant === "normalized")!;
    expect(normalized.quality).toBeGreaterThanOrEqual(75);
    // 2× a max-w-4xl (896 CSS px) modal panel, so a retina screen has no upscaling to do.
    expect(normalized.longEdgePx).toBeGreaterThanOrEqual(1792);
  });

  it("every spec is a real WebP quality and a positive bound", () => {
    for (const spec of DERIVATIVE_SPECS) {
      expect(spec.quality).toBeGreaterThan(0);
      expect(spec.quality).toBeLessThanOrEqual(100);
      expect(spec.longEdgePx).toBeGreaterThan(0);
      expect(spec.purpose.length).toBeGreaterThan(10);
    }
  });

  it("emits WebP, never the source format", () => {
    expect(DERIVATIVE_CONTENT_TYPE).toBe("image/webp");
  });
});

describe("shouldDerive", () => {
  it("derives from every image kind the documents table admits", () => {
    for (const ct of DOCUMENT_CONTENT_TYPES) {
      if (ct.startsWith("image/")) expect(shouldDerive(ct)).toBe(true);
    }
  });

  it("does NOT derive from a PDF — the browser's own viewer previews those (D-DQ9)", () => {
    expect(shouldDerive("application/pdf")).toBe(false);
    expect(derivativesFor("application/pdf")).toEqual([]);
  });

  it("includes HEIC, because the column admits it — decode capability is a deploy question, not a policy one", () => {
    expect(DERIVABLE_CONTENT_TYPES).toContain("image/heic");
  });

  it("never lists a content type the documents table would reject", () => {
    for (const ct of DERIVABLE_CONTENT_TYPES) {
      expect(DOCUMENT_CONTENT_TYPES).toContain(ct);
    }
  });

  it("returns the full spec list for a derivable type so callers can loop blindly", () => {
    expect(derivativesFor("image/jpeg")).toHaveLength(DERIVATIVE_SPECS.length);
  });
});

describe("derivativeFingerprint", () => {
  /**
   * THE PIN. If this fails, a bound or a quality changed. That is allowed — but it means every
   * derivative already in the bucket was produced by different rules, so decide deliberately:
   * bump DERIVATIVE_VERSION's major and plan a regeneration, or revert the edit. Do not "fix the
   * test" — the test failing IS the mechanism.
   */
  it("matches the pinned ruleset", () => {
    expect(derivativeFingerprint()).toBe("thumb:320:65|normalized:2000:82");
  });

  it("is stable across calls", () => {
    expect(derivativeFingerprint()).toBe(derivativeFingerprint());
  });

  it("carries a semver version to stamp on generated rows", () => {
    expect(DERIVATIVE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("derivativeStoragePath", () => {
  const ORG = "11111111-1111-1111-1111-111111111111";
  const DRIVER = "22222222-2222-2222-2222-222222222222";
  const DERIVATIVE = "33333333-3333-3333-3333-333333333333";

  it("keys on the derivative's own id, under the same org/subject prefix as the original", () => {
    expect(derivativeStoragePath(ORG, "driver", DRIVER, DERIVATIVE, "thumb")).toBe(
      `${ORG}/driver/${DRIVER}/${DERIVATIVE}.thumb.webp`,
    );
  });

  it("keeps org_id first — the bucket's INSERT policy scopes on foldername[1] (0146:122-128)", () => {
    expect(derivativeStoragePath(ORG, "driver", DRIVER, DERIVATIVE, "normalized").split("/")[0]).toBe(ORG);
  });

  it("gives the two variants of one document distinct keys", () => {
    const a = derivativeStoragePath(ORG, "driver", DRIVER, DERIVATIVE, "thumb");
    const b = derivativeStoragePath(ORG, "driver", DRIVER, DERIVATIVE, "normalized");
    expect(a).not.toBe(b);
  });

  it("always ends .webp, whatever the original was", () => {
    for (const spec of DERIVATIVE_SPECS) {
      expect(derivativeStoragePath(ORG, "driver", DRIVER, DERIVATIVE, spec.variant)).toMatch(/\.webp$/);
    }
  });

  it("works for a non-driver subject — the bucket was named for the wider vocabulary", () => {
    expect(derivativeStoragePath(ORG, "trailer", DRIVER, DERIVATIVE, "thumb")).toContain("/trailer/");
  });
});
