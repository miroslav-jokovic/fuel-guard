import { describe, expect, it } from "vitest";
import {
  BUNDLED_DEFAULT_CONFIG,
  canonicalStringify,
  compareConfigVersion,
  loadConfig,
  parseConfigVersion,
  validateConfig,
  type RemoteConfigEnvelope,
  type SignatureVerifier,
} from "../src/config.js";

const accept: SignatureVerifier = { verify: () => true };
const reject: SignatureVerifier = { verify: () => false };

function remote(version: string): RemoteConfigEnvelope {
  return { config: { ...BUNDLED_DEFAULT_CONFIG, configVersion: version }, signatureBase64: "sig" };
}

describe("config version parsing + ordering", () => {
  it("parses capture-YYYY.MM.N and rejects junk", () => {
    expect(parseConfigVersion("capture-2026.08.0")).toEqual({ year: 2026, month: 8, seq: 0 });
    expect(parseConfigVersion("capture-2026.13.0")).toBeNull();
    expect(parseConfigVersion("nope")).toBeNull();
  });
  it("orders by year, month, seq", () => {
    expect(compareConfigVersion("capture-2026.08.0", "capture-2026.08.1")).toBe(-1);
    expect(compareConfigVersion("capture-2026.09.0", "capture-2026.08.9")).toBe(1);
    expect(compareConfigVersion("capture-2026.08.0", "capture-2026.08.0")).toBe(0);
  });
});

describe("validateConfig", () => {
  it("accepts the bundled default and rejects malformed input", () => {
    expect(validateConfig(BUNDLED_DEFAULT_CONFIG)).not.toBeNull();
    expect(validateConfig({ configVersion: "capture-2026.08.0" })).toBeNull();
    expect(validateConfig(null)).toBeNull();
  });

  describe("shadow thresholds (D-SCAN10)", () => {
    // A round trip through JSON on purpose: a remote config arrives as text, and the ONLY thing that
    // distinguishes "retired on purpose" from "key left out" once it has been parsed is `null`
    // against `undefined`. Building the object in TypeScript would let a `null` written here reach
    // the validator by a route no real config ever takes.
    const parsed = (gates: Record<string, unknown>) =>
      validateConfig(
        JSON.parse(JSON.stringify({ ...BUNDLED_DEFAULT_CONFIG, gates: { ...BUNDLED_DEFAULT_CONFIG.gates, ...gates } })),
      );

    it("accepts an explicit null — that is how a threshold is retired", () => {
      expect(parsed({ blurLaplacianVarMin: null, contrastRmsMin: null, brightnessMeanRange: null })).not.toBeNull();
    });

    it("REJECTS a config that omits the key instead", () => {
      // §8: a bad config can never weaken the gate. If omission read as `null`, a signed override
      // could switch off blur, glare, shadow, brightness and contrast by shipping a `gates` object
      // that simply does not mention them — and the diff a reviewer saw would be a deletion, which
      // is the easiest thing in the world to miss. Retiring has to be written down.
      const withoutBlur = JSON.parse(JSON.stringify(BUNDLED_DEFAULT_CONFIG));
      delete withoutBlur.gates.blurLaplacianVarMin;
      expect(validateConfig(withoutBlur)).toBeNull();

      const withoutSmallText = JSON.parse(JSON.stringify(BUNDLED_DEFAULT_CONFIG));
      delete withoutSmallText.ocrLegibility.smallTextBandCoverageMin;
      expect(validateConfig(withoutSmallText)).toBeNull();
    });

    /**
     * Coverage joined the retired list at Step 5.3 (F6), and the validator had to be told — it was
     * checked with `isNum`, so a config retiring it would have been REJECTED as malformed and the
     * app would have silently kept the last-known-good one carrying the old 0.6.
     *
     * The omission half is asserted separately from the block above because coverage is the newest
     * member of this list and the asymmetry is the whole reason `null` is spelled out rather than
     * inferred.
     */
    it("lets coverage retire to null now that nothing measures it, but still refuses the key being dropped", () => {
      expect(parsed({ coverageMinFraction: null })).not.toBeNull();
      expect(parsed({ coverageMinFraction: 0.6 })).not.toBeNull();
      expect(parsed({ coverageMinFraction: "off" })).toBeNull();

      const withoutCoverage = JSON.parse(JSON.stringify(BUNDLED_DEFAULT_CONFIG));
      delete withoutCoverage.gates.coverageMinFraction;
      expect(validateConfig(withoutCoverage)).toBeNull();
    });

    it("still rejects a non-number that is not null", () => {
      expect(parsed({ blurLaplacianVarMin: "none" })).toBeNull();
      expect(parsed({ contrastRmsMin: true })).toBeNull();
    });

    it("does not let resolution or the score floor retire", () => {
      // These two never go to shadow: resolution is scale-free, and a null accept-score floor would
      // mean "accept on no evidence at all", which is the one thing §5 cannot allow.
      expect(parsed({ resolutionMinLongEdgePx: null })).toBeNull();
      expect(parsed({ overallAcceptScoreMin: null })).toBeNull();
    });
  });
});

describe("canonicalStringify", () => {
  it("sorts object keys deterministically", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("loadConfig — never weakens the gate (§8)", () => {
  it("uses the bundled default when there is no remote", async () => {
    const r = await loadConfig({ verifier: accept });
    expect(r.source).toBe("bundled");
    expect(r.config.configVersion).toBe("capture-2026.08.0");
  });
  it("rejects a remote with a bad signature, keeping last-known-good", async () => {
    const r = await loadConfig({ lastKnownGood: BUNDLED_DEFAULT_CONFIG, remote: remote("capture-2026.09.0"), verifier: reject });
    expect(r.source).toBe("last_known_good");
    expect(r.rejectedRemoteReason).toBe("bad_signature");
  });
  it("rejects a non-monotonic (older) remote even with a good signature", async () => {
    const base = { ...BUNDLED_DEFAULT_CONFIG, configVersion: "capture-2026.09.0" };
    const r = await loadConfig({ lastKnownGood: base, remote: remote("capture-2026.08.0"), verifier: accept });
    expect(r.source).toBe("last_known_good");
    expect(r.rejectedRemoteReason).toBe("not_monotonic");
  });
  it("accepts a newer, well-formed, signed remote", async () => {
    const r = await loadConfig({ lastKnownGood: BUNDLED_DEFAULT_CONFIG, remote: remote("capture-2026.09.0"), verifier: accept });
    expect(r.source).toBe("remote");
    expect(r.config.configVersion).toBe("capture-2026.09.0");
  });
});
