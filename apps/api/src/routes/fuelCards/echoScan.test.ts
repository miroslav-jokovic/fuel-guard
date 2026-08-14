import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FUEL_CARD_ROUTE_TABLE, isFuelCardVendorRequest } from "./vendorRateLimit.js";

/**
 * The echo scan's safety property is that it CANNOT write.
 *
 * Not "does not", "cannot": the module has no path to `setCardV2`, and this file is what keeps it
 * that way. A behavioural test cannot prove a negative like this — it can only show that the write
 * did not happen on the inputs it tried — so the check is structural, on the source.
 *
 * That is the same technique `routeAuth.test.ts` uses on `app.ts`'s mount lines, and for the same
 * reason: some properties live in the shape of the code rather than in its output.
 */

const source = readFileSync(fileURLToPath(new URL("./echoScan.ts", import.meta.url)), "utf8");

/**
 * Comments stripped, because the module's own documentation NAMES `setCardV2` in order to explain
 * that it never calls it. A check that cannot tell an explanation from a call would force the code
 * to stop explaining itself, which is the wrong trade.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the echo scan cannot dispatch a write", () => {
  it("does not reference setCardV2 at all", () => {
    // A zero-edit echo is still a FULL-DOCUMENT write if anything sends it. The write probe demands
    // a typed confirmation before it sends one; this endpoint has no confirmation because it has no
    // send. If this test fails, the endpoint's entire safety argument has changed.
    expect(code).not.toContain("setCardV2");
    expect(code).not.toContain("efsCardWrite");
  });

  it("builds the request and judges it, which is the whole point", () => {
    // The inverse of the assertion above: it must still be doing the work. A module that imported
    // nothing would trivially pass the no-write check.
    expect(code).toContain("serializeSetCardRequest");
    expect(code).toContain("assertEchoFidelity");
  });

  it("reads on the backfill lane, never the interactive one", () => {
    // 199 paced reads on the interactive lane would starve real card control for minutes. Every
    // vendor call this module makes has to name the backfill lane explicitly.
    expect(code).not.toContain('"interactive"');
    const priorities = [...code.matchAll(/priority: "([a-z]+)"/g)].map((m) => m[1]);
    expect(priorities.length).toBeGreaterThan(0);
    expect(new Set(priorities)).toEqual(new Set(["backfill"]));
  });

  it("never puts a whole card number in the response", () => {
    // Identified by last4 only. `cardNumber` is passed INTO getCardV2 and the serializer, which is
    // unavoidable, but nothing may carry it back out.
    expect(code).toContain("cardLast4");
    expect(code).not.toMatch(/last4:\s*cardNumber/);
    expect(code).not.toMatch(/cardNumber,?\s*\n?\s*ok:/);
  });
});

describe("credentials come from the read-only resolver, not the probe preamble", () => {
  /**
   * The bug this pins: the first version reused `resolveProbeCredentials`, which also enforces
   * `EFS_ALLOW_PRODUCTION_PROBE`. The endpoint then answered 403 on the production org — the only
   * org whose 199 cards the Phase 2 exit gate is about — and the only way to run it would have been
   * to set a flag that simultaneously unlocks two write probes against production.
   */
  it("does not go through resolveProbeCredentials", () => {
    expect(code).not.toContain("resolveProbeCredentials");
    expect(code).toContain("resolveReadOnlyScanCredentials");
  });

  it("leaves the production gate in place for everything that can write", async () => {
    // The three probe routes must keep it. If this fails, the read-only exemption has leaked.
    const writers = ["probe.ts", "writeProbe.ts", "experiments.ts"];
    for (const file of writers) {
      const src = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
      expect(src, `${file} must still use the gated preamble`).toContain("resolveProbeCredentials");
      expect(src, `${file} must not use the read-only resolver`).not.toContain("resolveReadOnlyScanCredentials");
    }
  });
});

describe("the scan is charged the vendor budget", () => {
  it("is classified as a SOAP route, because it is the heaviest one there is", () => {
    expect(isFuelCardVendorRequest({ method: "POST", path: "/api/fuel-cards/echo-scan" })).toBe(true);
  });

  it("appears in the route table exactly once", () => {
    const rows = FUEL_CARD_ROUTE_TABLE.filter((r) => r.path === "/echo-scan");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "POST", opensSoap: true });
  });

  it("stays charged when the path arrives with a trailing slash", () => {
    // The bypass that got through once already (plan §8). Re-asserted per SOAP route rather than
    // trusted to the normaliser staying correct.
    expect(isFuelCardVendorRequest({ method: "POST", path: "/api/fuel-cards/echo-scan/" })).toBe(true);
  });
});
