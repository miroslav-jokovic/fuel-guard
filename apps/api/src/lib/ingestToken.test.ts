import { describe, it, expect } from "vitest";
import { generateIngestToken, hashIngestToken } from "./ingestToken.js";

describe("ingest token", () => {
  it("mints a recognizable high-entropy token and persists only a stable hash", () => {
    const a = generateIngestToken();
    const b = generateIngestToken();
    expect(a.token).toMatch(/^fgtms_[A-Za-z0-9_-]{40,}$/); // prefixed, base64url, high entropy
    expect(a.token).not.toBe(b.token); // random per call
    expect(a.prefix).toBe(a.token.slice(0, 12));
    expect(a.hash).toHaveLength(64); // sha256 hex
    expect(a.hash).toBe(hashIngestToken(a.token)); // hash reproduces from the token
    expect(a.hash).not.toContain(a.token.slice(6)); // the stored hash never embeds the secret
  });

  it("hashing is deterministic and token-specific", () => {
    expect(hashIngestToken("x")).toBe(hashIngestToken("x"));
    expect(hashIngestToken("x")).not.toBe(hashIngestToken("y"));
  });
});
